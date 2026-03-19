import re
import sys
import json
import random
import sqlite3
import os
from collections import defaultdict, deque
from difflib import get_close_matches

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from typing import List, Optional

_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data")
DB_PATH = os.path.join(_BASE, "brain.sqlite")
EMOJI_PATH = os.path.join(_BASE, "emojis.json")

# Emoji resolver
class EmojiResolver:
    def __init__(self, path: str = EMOJI_PATH):
        with open(path, encoding="utf-8") as f:
            self._map = json.load(f) # {":name:": "<a:name:id>"}
        # strip colons for fuzzy lookup
        self._names = [k.strip(":") for k in self._map]

    def resolve(self, text: str) -> str:
        """Replace all :name: tokens in text with Discord emoji or remove them."""
        def replace(m):
            token = m.group(0) # e.g. ":cryingcat:"
            name  = m.group(1) # e.g. "cryingcat"
            # exact match
            if token in self._map:
                return self._map[token]
            # fuzzy match (cutoff 0.6 - close enough for short names)
            close = get_close_matches(name, self._names, n=1, cutoff=0.6)
            if close:
                return self._map[f":{close[0]}:"]
            # no match - drop it
            return ""
        return re.sub(r":([A-Za-z0-9_]+):", replace, text).strip()

def normalize(text: str) -> str:
    """Lowercase, strip punctuation noise, collapse whitespace."""
    text = text.lower().strip()
    text = re.sub(r"<@!?\d+>", "", text)     # remove Discord mentions
    text = re.sub(r"<a?:\w+:\d+>", "", text) # remove custom emojis
    text = re.sub(r"https?://\S+", "", text) # remove URLs
    text = re.sub(r"\s+", " ", text).strip()
    return text

def tokenize(text: str) -> List[str]:
    return normalize(text).split()

# Markov chain (trigram with bigram + unigram fallback)
class MarkovBrain:
    def __init__(self):
        self.trigrams: dict = defaultdict(list)
        self.bigrams:  dict = defaultdict(list)
        self.starters: list = []

    def train(self, messages: List[str]):
        for msg in messages:
            words = tokenize(msg)
            if not words:
                continue
            self.starters.append(words[0])
            for i in range(len(words)):
                if i + 2 < len(words):
                    self.trigrams[(words[i], words[i+1])].append(words[i+2])
                if i + 1 < len(words):
                    self.bigrams[words[i]].append(words[i+1])

    def generate(self, seed: str = "", max_words: int = 30) -> str:
        words = tokenize(seed)

        # pick a starter word
        if words and words[-1] in self.bigrams: current = words[-1]
        elif words and len(words) >= 2 and (words[-2], words[-1]) in self.trigrams: current = words[-2]
        elif self.starters: current = random.choice(self.starters)
        else: return ""

        result = [current]
        for _ in range(max_words):
            prev2 = (result[-2], result[-1]) if len(result) >= 2 else None
            prev1 = result[-1]

            if prev2 and prev2 in self.trigrams: nxt = random.choice(self.trigrams[prev2])
            elif prev1 in self.bigrams: nxt = random.choice(self.bigrams[prev1])
            else: break
            result.append(nxt)
            # natural stopping: short messages are authentic here
            if len(result) >= 6 and random.random() < 0.25:
                break
        return " ".join(result)
    
# Retrieval layer (TF-IDF cosine similarity over pairs.parentKey)
class RetrievalBrain:
    def __init__(self):
        self.keys: list[str] = []
        self.replies: list[str] = []
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.matrix = None

    def train(self, keys: List[str], replies: List[str]):
        self.keys = [normalize(k) for k in keys]
        self.replies = replies
        self.vectorizer = TfidfVectorizer(
            analyzer="char_wb", # char n-grams handle dialect + typos better
            ngram_range=(2, 4),
            min_df=1,
        )
        self.matrix = self.vectorizer.fit_transform(self.keys)

    def query(self, text: str, threshold: float = 0.25, exclude: set = None) -> Optional[str]:
        if self.vectorizer is None or not text.strip():
            return None
        vec = self.vectorizer.transform([normalize(text)])
        sims = cosine_similarity(vec, self.matrix).flatten()
        best_idx = int(np.argmax(sims))
        best_score = float(sims[best_idx])
        if best_score >= threshold:
            # widen pool to ±0.15 of best score for variety, still above threshold
            candidates = [
                self.replies[i]
                for i, s in enumerate(sims)
                if s >= max(best_score - 0.15, threshold) and self.replies[i].strip()
                and (exclude is None or self.replies[i] not in exclude)
            ]
            if not candidates:
                # exclusion filtered everything — relax it
                candidates = [
                    self.replies[i]
                    for i, s in enumerate(sims)
                    if s >= threshold and self.replies[i].strip()
                ]
            return random.choice(candidates) if candidates else None
        return None

# Combined bot
class BierliBot:
    def __init__(self, db_path: str = DB_PATH, retrieval_threshold: float = 0.25):
        self.threshold = retrieval_threshold
        self.retrieval = RetrievalBrain()
        self.markov = MarkovBrain()
        self.emojis = EmojiResolver()
        self._recent: deque = deque(maxlen=6)
        self._load(db_path)

    def _load(self, db_path: str):
        conn = sqlite3.connect(db_path)
        c = conn.cursor()

        # pairs → retrieval
        c.execute("SELECT parentKey, reply FROM pairs WHERE parentKey != '' AND reply != ''")
        rows = c.fetchall()
        keys, replies = zip(*rows) if rows else ([], [])
        print(f"[brain] loading {len(keys)} pairs for retrieval…", file=sys.stderr)
        self.retrieval.train(list(keys), list(replies))

        # all messages → markov
        c.execute("SELECT content FROM messages WHERE content != ''")
        messages = [r[0] for r in c.fetchall()]
        print(f"[brain] training markov on {len(messages)} messages…", file=sys.stderr)
        self.markov.train(messages)

        conn.close()
        print("[brain] ready.\n", file=sys.stderr)

    def reply(self, text: str) -> str:
        exclude = set(self._recent)

        # 1. try retrieval (passes recent replies to avoid repeats)
        hit = self.retrieval.query(text, threshold=self.threshold, exclude=exclude)

        # 2. fall back to markov, retry a few times to dodge recent replies
        if hit is None:
            for _ in range(4):
                candidate = self.markov.generate(seed=text, max_words=25)
                if candidate and candidate not in exclude:
                    hit = candidate
                    break
            if hit is None:
                hit = self.markov.generate(seed=text, max_words=25) or "…"

        raw = self.emojis.resolve(hit)
        self._recent.append(raw)
        return raw

    def serve(self):
        """JSON line server mode: read {text} from stdin, write {ok, result} to stdout."""
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
                result = self.reply(req.get("text", ""))
                print(json.dumps({"ok": True, "result": result}), flush=True)
            except Exception as e:
                print(json.dumps({"ok": False, "error": str(e)}), flush=True)

    def chat(self):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print("bierli-ai — type something (ctrl+c to quit)\n")
        try:
            while True:
                user = input("du:     ").strip()
                if not user:
                    continue
                print(f"bierli: {self.reply(user)}\n")
        except (KeyboardInterrupt, EOFError):
            print("\ntschüss!")

# Entry point
if __name__ == "__main__":
    bot = BierliBot()
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        bot.serve()
    else:
        bot.chat()
