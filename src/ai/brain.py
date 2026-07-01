import re
import sys
import json
import math
import random
import sqlite3
import os
from collections import defaultdict, deque, Counter
from difflib import get_close_matches
from typing import List, Optional, Dict, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize as l2_normalize
from sklearn.metrics.pairwise import cosine_similarity

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data")
DB_PATH = os.path.join(_BASE, "brain.sqlite")
EMOJI_PATH = os.path.join(_BASE, "emojis.json")

# How much the latent-semantic (LSA) similarity may BOOST a candidate when
# lexical retrieval is weak. LSA is a safety net, never the primary signal.
LSA_WEIGHT = 0.40
# Target latent dimensions for TruncatedSVD (clamped to the corpus size).
LSA_COMPONENTS = 300
# Below this many pairs the LSA layer is skipped (not enough signal).
LSA_MIN_PAIRS = 50
# If the best raw TF-IDF cosine reaches this, we have a confident lexical
# match and skip LSA entirely (keeps exact greetings etc. pristine).
LSA_LEXICAL_TRUST = 0.45

# Below this best candidate score, retrieval is a miss -> fallback bucket.
MIN_RELEVANT_SCORE = 0.30
# Candidates within this score of the best are eligible for the weighted pick.
# Having many near-best replies is GOOD (on-topic variety), not ambiguity.
SHORTLIST_WINDOW = 0.60
# Only consider mutating (markov-extending) a reply when we're not confident.
MUTATE_BELOW_SCORE = 0.90
# How strongly neighbor consensus counts: if many similar parents produced the
# same reply, that agreement is a strong signal it's the right answer.
CONSENSUS_WEIGHT = 0.85

# Austrian / German dialect equivalence map. Applied ONLY to the matching
# surfaces (vectorizer input + lexical overlap) so that dialect spelling
# variants collapse onto a shared form and retrieval matches across them.
# Stored replies are NEVER rewritten, so the bot still answers in dialect.
DIALECT_MAP: Dict[str, str] = {
    # negation
    "ned": "nicht", "net": "nicht", "nit": "nicht", "nid": "nicht", "nix": "nichts",
    # sein / haben
    "is": "ist", "hod": "hat", "hob": "habe", "hot": "hat", "ham": "haben",
    # was / wie / wer
    "wos": "was", "wia": "wie", "wea": "wer",
    # alles / etwas
    "ois": "alles", "oiss": "alles", "eppas": "etwas", "epas": "etwas",
    # ich / wir
    "i": "ich", "mia": "wir", "mir": "wir",
    # oder / aber
    "oda": "oder", "oba": "aber", "owa": "aber",
    # gehen / machen / schauen
    "gemma": "gehen", "moch": "mache", "mochn": "machen", "schaun": "schauen",
    # gut / cool / richtig
    "leiwand": "super", "leiwaund": "super", "guad": "gut", "gscheit": "richtig",
    # auch / schon
    "aa": "auch", "scho": "schon",
    # discourse / fillers normalized for matching
    "oida": "alter", "oide": "alter", "ojda": "alter",
    "host": "hast", "kummt": "kommt", "kumma": "kommen",
}

_DIALECT_PHRASES = {k: v for k, v in DIALECT_MAP.items() if " " in k}
_DIALECT_TOKENS = {k: v for k, v in DIALECT_MAP.items() if " " not in k}

# Question markers (German + Austrian).
_QUESTION_WORDS = {
    "warum", "wieso", "weshalb", "weshoib", "wie", "wer", "wo", "was",
    "wann", "wem", "wen", "wessen", "wieviel", "welche", "welcher", "welches",
    "gell", "oder", "ob", "kann", "konn", "kannst", "konnst", "soll", "muss",
}

# Tiny throwaway replies (German + Austrian + chat slang).
_GENERIC_WORDS = {
    "ja", "jo", "ok", "oke", "okay", "safe", "aso", "ahso", "fix", "passt",
    "lol", "lmao", "xd", "haha", "hahaha", "hehe", "ne", "na", "nein", "gut",
    "k", "kk", "sicher", "super", "richtig", "true", "real", "fr", "hm", "hmm",
    "alter", "eh", "schon",
}

# Low-confidence / "dunno" markers (German + Austrian).
_UNCERTAIN_MARKERS = [
    "ka", "kp", "ka ahnung", "keine ahnung", "woas ned", "waß ned", "weiß nicht",
    "weiss nicht", "wei ned", "vielleicht", "kein plan", "sicher nicht",
    "hmm", "wer waß", "wer weiss", "gute frage",
]

class EmojiResolver:
    def __init__(self, path: str = EMOJI_PATH):
        with open(path, encoding="utf-8") as f:
            self._map = json.load(f)  # {":name:": "<a:name:id>"}
        # strip colons for fuzzy lookup
        self._names = [k.strip(":") for k in self._map]

    def resolve(self, text: str) -> str:
        def replace(m):
            token = m.group(0)  # e.g. ":cryingcat:"
            name = m.group(1)   # e.g. "cryingcat"
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
    text = (text or "").lower().strip()      # lowercase and trim
    text = re.sub(r"<@!?\d+>", "", text)     # remove Discord mentions
    text = re.sub(r"<a?:\w+:\d+>", "", text)  # remove custom emojis
    text = re.sub(r"https?://\S+", "", text)  # remove URLs
    text = re.sub(r"\s+", " ", text).strip()  # collapse whitespace
    return text

def canon(text: str) -> str:
    """Normalize + collapse Austrian dialect variants for MATCHING only."""
    t = normalize(text)
    if not t:
        return t
    # multi-word dialect phrases first
    for phrase, repl in _DIALECT_PHRASES.items():
        t = re.sub(rf"\b{re.escape(phrase)}\b", repl, t)
    toks = t.split()
    return " ".join(_DIALECT_TOKENS.get(tok, tok) for tok in toks)

def tokenize(text: str) -> List[str]:
    """Raw tokens (no dialect collapse) - used for length/quality checks."""
    return normalize(text).split()

def canon_tokens(text: str) -> List[str]:
    return canon(text).split()

def is_question(text: str) -> bool:
    words = set(canon(text).split())
    return "?" in (text or "") or any(w in words for w in _QUESTION_WORDS)

def lexical_overlap(a: str, b: str) -> float:
    aa = set(canon_tokens(a))
    bb = set(canon_tokens(b))
    if not aa or not bb:
        return 0.0
    return len(aa & bb) / len(aa | bb)

def looks_generic(text: str) -> bool:
    toks = canon_tokens(text)
    return len(toks) <= 2 and bool(toks) and all(tok in _GENERIC_WORDS for tok in toks)

# Scam / raid spam that bots dump into chats - must never be learned or echoed.
_SPAM_RE = re.compile(
    r"discord\.(gg|com/invite)|\.com/invite|t\.me/|bit\.ly|"
    r"free\s*nitro|steamcommunity\.com|@everyone|@here|onlyfans|"
    r"sugar.?(girls|daddy)|nudes|click\s+here|airdrop",
    re.IGNORECASE,
)

# Exact responses to permanently ban (normalized match). Add lines here and
# they'll be dropped from retrieval, fallback and markov on the next reload.
RESPONSE_BLACKLIST = [
    "hab mei karze heute abgeholt wieder",
]
_BLACKLIST_NORMS = {normalize(b) for b in RESPONSE_BLACKLIST}

def looks_spam(text: str) -> bool:
    if normalize(text) in _BLACKLIST_NORMS:
        return True
    return bool(_SPAM_RE.search(text or ""))

def looks_uncertain_reply(text: str) -> bool:
    t = canon(text)
    if not t:
        return False
    return any(m in t for m in (canon(m) for m in _UNCERTAIN_MARKERS))

class MarkovBrain:
    def __init__(self):
        self.trigrams: Dict[Tuple[str, str], List[str]] = defaultdict(list)
        self.bigrams: Dict[str, List[str]] = defaultdict(list)
        self.starters: List[Tuple[str, ...]] = []

    def train(self, messages: List[str]):
        self.trigrams.clear()
        self.bigrams.clear()
        self.starters.clear()
        for msg in messages:
            words = tokenize(msg)
            if not words:
                continue
            if len(words) >= 2:
                self.starters.append((words[0], words[1]))
            else:
                self.starters.append((words[0],))
            for i in range(len(words)):
                if i + 2 < len(words):
                    self.trigrams[(words[i], words[i + 1])].append(words[i + 2])
                if i + 1 < len(words):
                    self.bigrams[words[i]].append(words[i + 1])

    def generate(self, seed: str = "", max_words: int = 20) -> str:
        words = tokenize(seed)
        result: List[str] = []
        if len(words) >= 2 and (words[-2], words[-1]) in self.trigrams:
            result = [words[-2], words[-1]]
        elif len(words) >= 1 and words[-1] in self.bigrams:
            result = [words[-1]]
        elif self.starters:
            result = list(random.choice(self.starters))
        else:
            return ""
        while len(result) < max_words:
            if len(result) >= 2 and (result[-2], result[-1]) in self.trigrams:
                nxt = random.choice(self.trigrams[(result[-2], result[-1])])
            elif result[-1] in self.bigrams:
                nxt = random.choice(self.bigrams[result[-1]])
            else:
                break
            if len(result) >= 3 and nxt == result[-1] == result[-2]:
                break
            result.append(nxt)
            if len(result) >= 5 and random.random() < 0.22:
                break
        return " ".join(result).strip()

    def continue_from(self, prefix: str, extra_words: int = 8) -> str:
        base = tokenize(prefix)
        if not base:
            return ""
        result = base[:]
        while len(result) < len(base) + extra_words:
            if len(result) >= 2 and (result[-2], result[-1]) in self.trigrams:
                nxt = random.choice(self.trigrams[(result[-2], result[-1])])
            elif result[-1] in self.bigrams:
                nxt = random.choice(self.bigrams[result[-1]])
            else:
                break
            if nxt in result[-4:]:
                break
            result.append(nxt)
            if len(result) >= len(base) + 3 and random.random() < 0.35:
                break
        return " ".join(result).strip()

class CorpusRetriever:
    """TF-IDF (word + char n-grams) with a TruncatedSVD/LSA semantic layer.

    Final similarity blends raw lexical TF-IDF cosine with latent-semantic
    cosine, so paraphrases that share no words/letters can still match.
    """

    def __init__(self):
        self.keys: List[str] = []
        self.replies: List[str] = []
        self.reply_norms: List[str] = []
        self.reply_freq: Counter = Counter()
        self.vectorizer: Optional[FeatureUnion] = None
        self.matrix = None
        self.svd: Optional[TruncatedSVD] = None
        self.lsa_matrix = None
        # second vector space over the REPLIES themselves, for reply-space
        # consensus (how much the retrieved neighbourhood agrees on an answer)
        self.reply_vectorizer: Optional[FeatureUnion] = None
        self.reply_matrix = None

    @staticmethod
    def _build_vectorizer() -> FeatureUnion:
        return FeatureUnion([
            ("word", TfidfVectorizer(
                analyzer="word",
                ngram_range=(1, 2),
                min_df=2,
                sublinear_tf=True,
            )),
            ("char", TfidfVectorizer(
                analyzer="char_wb",
                ngram_range=(3, 5),
                min_df=1,
                sublinear_tf=True,
            )),
        ])

    def train(self, keys: List[str], replies: List[str]):
        cleaned = []
        for k, r in zip(keys, replies):
            ck = canon(k)
            nr = normalize(r)
            if ck and nr:
                cleaned.append((ck, r, nr))
        if not cleaned:
            self.keys, self.replies, self.reply_norms = [], [], []
            self.reply_freq = Counter()
            self.vectorizer = None
            self.matrix = None
            self.svd = None
            self.lsa_matrix = None
            self.reply_vectorizer = None
            self.reply_matrix = None
            return
        self.keys = [k for k, _, _ in cleaned]
        self.replies = [r for _, r, _ in cleaned]
        self.reply_norms = [nr for _, _, nr in cleaned]
        self.reply_freq = Counter(self.reply_norms)
        self.vectorizer = self._build_vectorizer()
        self.matrix = self.vectorizer.fit_transform(self.keys)
        self._fit_lsa()
        # vectorize the replies too so we can measure reply-to-reply agreement
        try:
            self.reply_vectorizer = self._build_vectorizer()
            self.reply_matrix = self.reply_vectorizer.fit_transform(self.reply_norms)
        except Exception as e:  # pragma: no cover - defensive (tiny corpora)
            print(f"[brain] reply-space disabled: {e}", file=sys.stderr)
            self.reply_vectorizer = None
            self.reply_matrix = None

    def _fit_lsa(self):
        self.svd = None
        self.lsa_matrix = None
        if self.matrix is None:
            return
        n_samples, n_features = self.matrix.shape
        if n_samples < LSA_MIN_PAIRS or n_features < 2:
            return
        # TruncatedSVD needs n_components < n_features and <= n_samples.
        n_comp = min(LSA_COMPONENTS, n_features - 1, n_samples - 1)
        if n_comp < 2:
            return
        try:
            self.svd = TruncatedSVD(n_components=n_comp, random_state=42)
            dense = self.svd.fit_transform(self.matrix)
            self.lsa_matrix = l2_normalize(dense)
        except Exception as e:  # pragma: no cover - defensive
            print(f"[brain] LSA fit failed, using TF-IDF only: {e}", file=sys.stderr)
            self.svd = None
            self.lsa_matrix = None

    def _query_sims(self, text: str) -> np.ndarray:
        if self.vectorizer is None or self.matrix is None:
            return np.array([])
        q = canon(text)
        if not q:
            return np.array([])
        vec = self.vectorizer.transform([q])
        tfidf_sims = cosine_similarity(vec, self.matrix).flatten()
        if self.svd is None or self.lsa_matrix is None:
            return tfidf_sims
        # LSA is a SAFETY NET, not the primary signal. When a strong lexical
        # match exists, trust it completely so exact matches stay perfect.
        # Only when lexical retrieval is weak do we let semantic similarity
        # ADD a boost to related-but-differently-worded candidates (it can
        # never drag a lexical score down).
        if tfidf_sims.size and tfidf_sims.max() >= LSA_LEXICAL_TRUST:
            return tfidf_sims
        lsa_vec = l2_normalize(self.svd.transform(vec))
        lsa_sims = cosine_similarity(lsa_vec, self.lsa_matrix).flatten()
        return tfidf_sims + (lsa_sims * LSA_WEIGHT)

    def top_candidates(self, text: str, context: Optional[List[str]] = None, limit: int = 30) -> List[dict]:
        if self.vectorizer is None or self.matrix is None:
            return []
        context = context or []
        if not canon(text):
            return []
        sims = self._query_sims(text)
        if sims.size == 0:
            return []
        # weighted multi-query instead of one mushy concatenated blob
        if context:
            prev1 = context[0] if len(context) >= 1 else ""
            prev2 = context[1] if len(context) >= 2 else ""
            if prev1:
                s1 = self._query_sims(f"{prev1} {text}".strip())
                if s1.size == sims.size:
                    sims = (sims * 0.80) + (s1 * 0.20)
            if prev2 and prev1:
                s2 = self._query_sims(f"{prev2} {prev1} {text}".strip())
                if s2.size == sims.size:
                    sims = (sims * 0.95) + (s2 * 0.05)
        order = np.argsort(sims)[::-1][:limit]
        out = []
        for i in order:
            if sims[i] <= 0:
                continue
            out.append({
                "idx": int(i),
                "parent": self.keys[i],
                "reply": self.replies[i],
                "reply_norm": self.reply_norms[i],
                "sim": float(sims[i]),
                "freq": self.reply_freq[self.reply_norms[i]],
            })
        return out

    def reply_consensus(self, cands: List[dict]) -> np.ndarray:
        """For each candidate, how strongly the rest of the retrieved
        neighbourhood AGREES with its reply (similarity-weighted).

        Generalizes exact-duplicate consensus to near-duplicate replies, so
        the answer the crowd converges on gets boosted even when worded
        differently. Returns an array aligned with ``cands``.
        """
        n = len(cands)
        if n == 0:
            return np.zeros(0)
        if self.reply_matrix is None:
            # fall back to exact-duplicate agreement
            support: Dict[str, float] = defaultdict(float)
            for c in cands:
                support[c["reply_norm"]] += c["sim"]
            return np.array([support[c["reply_norm"]] for c in cands])
        idxs = [c["idx"] for c in cands]
        weights = np.array([c["sim"] for c in cands])
        sub = self.reply_matrix[idxs]
        sim = cosine_similarity(sub)          # n x n reply-to-reply similarity
        return sim.dot(weights)               # neighbour-weighted agreement

class HopfiBrain:
    def __init__(self, db_path: str = DB_PATH):
        self.retriever = CorpusRetriever()
        self.markov = MarkovBrain()
        self.emojis = EmojiResolver()
        self._recent_raw: deque = deque(maxlen=15)
        self._recent_norm: deque = deque(maxlen=15)
        self._fallback_replies: List[str] = []
        self._load(db_path)

    def _load(self, db_path: str):
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT parentKey, reply FROM pairs WHERE parentKey != '' AND reply != ''")
        # drop scam/raid spam so it can never be retrieved or echoed
        rows = [(k, r) for k, r in c.fetchall() if not looks_spam(r) and not looks_spam(k)]
        keys, replies = zip(*rows) if rows else ([], [])
        print(f"[brain] loading {len(keys)} pairs for retrieval…", file=sys.stderr)
        self.retriever.train(list(keys), list(replies))
        lsa = "on" if self.retriever.svd is not None else "off"
        print(f"[brain] LSA semantic layer: {lsa}", file=sys.stderr)
        c.execute("SELECT content FROM messages WHERE content != ''")
        messages = [r[0] for r in c.fetchall() if not looks_spam(r[0])]
        print(f"[brain] training markov on {len(messages)} messages…", file=sys.stderr)
        self.markov.train(messages)
        # learned fallback bucket from your own corpus
        c.execute("SELECT reply FROM pairs WHERE reply != ''")
        raw_replies = [r[0] for r in c.fetchall()]
        self._fallback_replies = [
            r for r in raw_replies
            if self._quality_ok(r) and (looks_uncertain_reply(r) or looks_generic(r) or len(tokenize(r)) <= 5)
        ]
        conn.close()
        print("[brain] ready.\n", file=sys.stderr)

    def _score_candidate(self, inp: str, cand: dict) -> float:
        score = cand["sim"] * 3.1
        # gently discourage globally spammy replies (e.g. "lol"), but keep it
        # light - neighbor consensus (added in _choose_reply) is what decides
        # which genuinely-common reply is the right one for THIS input.
        score -= math.log1p(cand["freq"]) * 0.15
        # heavily penalize repeats
        if cand["reply_norm"] in self._recent_norm:
            score -= 2.0
        # parent should match the current input, not just vaguely
        parent_overlap = lexical_overlap(inp, cand["parent"])
        score += parent_overlap * 1.10
        # small bonus for reply lexical relation, but avoid parroting
        reply_overlap = lexical_overlap(inp, cand["reply"])
        score += reply_overlap * 0.18
        if reply_overlap > 0.75:
            score -= 0.9
        if looks_generic(cand["reply"]):
            score -= 0.85
        in_len = len(tokenize(inp))
        out_len = len(tokenize(cand["reply"]))
        inp_is_q = is_question(inp)
        parent_is_q = is_question(cand["parent"])
        if inp_is_q and parent_is_q:
            score += 0.25
        if inp_is_q and out_len <= 1:
            score -= 0.30
        # short user input should not get essay replies
        if in_len <= 3 and out_len > 10:
            score -= 0.55
        # long user input should not get ultra-short throwaways
        if in_len >= 8 and out_len <= 1:
            score -= 0.45
        # giant lore dumps are rarely good
        if out_len >= 28:
            score -= 0.35
        return score

    def _choose_reply(self, text: str, context: Optional[List[str]] = None) -> Tuple[Optional[str], float]:
        cands = self.retriever.top_candidates(text, context=context, limit=40)
        if not cands:
            return None, -999.0
        # Reply-space consensus: how strongly the retrieved neighbourhood
        # agrees on an answer (similarity-weighted, near-duplicates included).
        # The reply the crowd converges on gets boosted; one-off noise doesn't.
        consensus = self.retriever.reply_consensus(cands)
        scored = [
            (self._score_candidate(text, c) + CONSENSUS_WEIGHT * math.log1p(max(0.0, consensus[k])), c)
            for k, c in enumerate(cands)
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        # dedupe by normalized reply first
        unique = []
        seen = set()
        for s, c in scored:
            nr = c["reply_norm"]
            if nr in seen:
                continue
            seen.add(nr)
            unique.append((s, c))
        if not unique:
            return None, -999.0
        # Discourage repetition HARD: drop replies used in the recent window
        # entirely (the consensus boost otherwise keeps re-picking the same
        # top reply). Only relax this if it would leave us with nothing.
        fresh = [(s, c) for s, c in unique if c["reply_norm"] not in self._recent_norm]
        if fresh:
            pool = fresh
        else:
            # everything was used recently; at least never repeat back-to-back
            last = self._recent_norm[-1] if self._recent_norm else None
            relaxed = [(s, c) for s, c in unique if c["reply_norm"] != last]
            pool = relaxed if relaxed else unique
        best_score = pool[0][0]
        # genuinely nothing relevant -> caller uses the learned fallback bucket
        if best_score < MIN_RELEVANT_SCORE:
            return None, best_score
        # Many equally-good replies is the BEST case for a chat bot, not
        # ambiguity. Shortlist the near-best candidates and pick one at
        # weighted random: stays on-topic, but not robotically repetitive.
        shortlist = [(s, c) for s, c in pool if s >= best_score - SHORTLIST_WINDOW and s > 0.15][:6]
        weights = [max(0.05, s) for s, _ in shortlist]
        idx = random.choices(range(len(shortlist)), weights=weights, k=1)[0]
        picked_score, picked = shortlist[idx]
        return picked["reply"], picked_score

    def _mutate_reply(self, base_reply: str, user_text: str) -> str:
        user_len = len(tokenize(user_text))
        user_is_question = is_question(user_text)
        if random.random() < 0.72:
            return base_reply
        max_extra = 2 if user_len <= 3 else 5
        if random.random() < 0.60:
            continued = self.markov.continue_from(
                base_reply,
                extra_words=random.randint(1, max_extra),
            )
            if continued and normalize(continued) != normalize(base_reply):
                if lexical_overlap(base_reply, continued) >= 0.45:
                    if not user_is_question or lexical_overlap(user_text, continued) > 0:
                        return continued
        gen = self.markov.generate(
            seed=base_reply,
            max_words=max(5, len(tokenize(base_reply)) + max_extra),
        )
        if gen and lexical_overlap(base_reply, gen) >= 0.40:
            if not user_is_question or lexical_overlap(user_text, gen) > 0:
                return gen
        return base_reply

    def _quality_ok(self, text: str) -> bool:
        nt = normalize(text)
        toks = tokenize(nt)
        if not nt:
            return False
        if looks_spam(text):
            return False
        if nt in self._recent_norm:
            return False
        if len(toks) < 1 or len(toks) > 18:
            return False
        counts = Counter(toks)
        if max(counts.values(), default=0) >= 3:
            return False
        if len(toks) >= 4 and len(set(toks)) / max(1, len(toks)) < 0.40:
            return False
        one_char = sum(1 for t in toks if len(t) == 1)
        if one_char >= max(3, len(toks) // 2):
            return False
        for i in range(len(toks) - 2):
            if toks[i] == toks[i + 1] == toks[i + 2]:
                return False
        return True

    def _fallback_reply(self, text: str) -> str:
        inp_is_q = is_question(text)
        pool = [r for r in self._fallback_replies if normalize(r) not in self._recent_norm]
        if inp_is_q:
            qish = [r for r in pool if len(tokenize(r)) <= 6]
            if qish:
                pool = qish
        if pool:
            return random.choice(pool)
        # very last resort only
        for _ in range(4):
            gen = self.markov.generate(seed=text, max_words=10)
            if self._quality_ok(gen):
                return gen
        return "jo eh"

    def reply(self, text: str, context: Optional[List[str]] = None) -> str:
        context = context or []
        hit, score = self._choose_reply(text, context=context)
        if hit is not None:
            candidate = hit
            if score < MUTATE_BELOW_SCORE and self._quality_ok(candidate):
                candidate = self._mutate_reply(candidate, text)
        else:
            candidate = self._fallback_reply(text)
        raw = self.emojis.resolve(candidate)
        # never hand back an empty string - Discord rejects empty replies,
        # and emoji-only candidates can resolve to nothing.
        if not raw.strip():
            candidate = "jo eh"
            raw = "jo eh"
        self._recent_raw.append(raw)
        # Track the PRE-resolution form so the repeat key matches a candidate's
        # reply_norm (resolving :emoji: tokens would otherwise desync them and
        # let the same reply repeat back-to-back).
        self._recent_norm.append(normalize(candidate))
        return raw

    def serve(self):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
                if req.get("reload"):
                    self._load(DB_PATH)
                    print(json.dumps({"ok": True, "result": "reloaded"}), flush=True)
                    continue
                text = req.get("text", "") or ""
                context = req.get("context", []) or []
                if not isinstance(context, list):
                    context = []
                result = self.reply(text, context=context)
                print(json.dumps({"ok": True, "result": result}), flush=True)
            except Exception as e:
                print(json.dumps({"ok": False, "error": str(e)}), flush=True)

    def chat(self):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print("hopfi-ai - type something (ctrl+c to quit)\n")
        try:
            while True:
                user = input("you:     ").strip()
                if not user:
                    continue
                print(f"hopfi: {self.reply(user)}\n")
        except (KeyboardInterrupt, EOFError):
            print("\nbye!")

if __name__ == "__main__":
    bot = HopfiBrain()
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        bot.serve()
    else:
        bot.chat()
