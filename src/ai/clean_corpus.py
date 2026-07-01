"""One-time corpus cleanup for the chat brain.

Removes low-quality (parentKey -> reply) pairs from data/brain.sqlite so the
retriever works on a cleaner pool. CPU-only, no GPU.

Two kinds of removal:
  1. structural  - empty / parent==reply / spam / junk / lore-dump replies
  2. isolated    - a reply that, among MANY similar parents, nobody corroborates
                   (likely cross-conversation noise). Rare parents are kept.

Usage:
    ./.venv/bin/python src/ai/clean_corpus.py            # dry-run (default)
    ./.venv/bin/python src/ai/clean_corpus.py --apply    # backup + delete

Always backs up to brain.sqlite.bak-<timestamp> before applying.
"""
import os
import sys
import time
import shutil
import sqlite3
import argparse

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brain  # noqa: E402

# --- isolated-noise thresholds (conservative: favour keeping data) ----------
PARENT_NEIGHBOR_SIM = 0.55   # how similar another parent must be to count as a neighbour
MIN_NEIGHBORS = 5            # only judge "isolated" when the parent is well-represented
REPLY_CORROBORATE_SIM = 0.40  # a neighbour reply this similar counts as corroboration
CHUNK = 512


def _is_junk_reply(reply: str) -> bool:
    # Deliberately conservative: dialect one-liners ("i a" = ich auch) and lone
    # emoji reactions are VALID personality, so we only drop the clear cases.
    toks = brain.tokenize(reply)
    if not toks:
        return True                # empty after cleaning
    if len(toks) > 45:             # lore dump
        return True
    return False


def _structural_drop(parent: str, reply: str) -> str:
    """Return a reason string if the pair should be dropped, else ''."""
    pc, rn = brain.canon(parent), brain.normalize(reply)
    if not pc or not rn:
        return "empty"
    if brain.normalize(parent) == rn:
        return "parent==reply"
    if brain.looks_spam(parent) or brain.looks_spam(reply):
        return "spam/blacklist"
    if _is_junk_reply(reply):
        return "junk-reply"
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually delete (default: dry-run)")
    ap.add_argument("--db", default=brain.DB_PATH)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    c = conn.cursor()
    rows = c.execute("SELECT id, parentKey, reply FROM pairs WHERE parentKey != '' AND reply != ''").fetchall()
    total = len(rows)
    print(f"loaded {total} non-empty pairs from {args.db}")

    drop_ids = set()
    reasons = {}
    samples = {}

    # --- 1. structural -----------------------------------------------------
    survivors = []
    for pid, parent, reply in rows:
        reason = _structural_drop(parent, reply)
        if reason:
            drop_ids.add(pid)
            reasons[reason] = reasons.get(reason, 0) + 1
            samples.setdefault(reason, []).append((parent, reply))
        else:
            survivors.append((pid, parent, reply))

    # --- 2. isolated noise (consensus-based) -------------------------------
    parents_canon = [brain.canon(p) for _, p, _ in survivors]
    replies_norm = [brain.normalize(r) for _, _, r in survivors]
    vec = brain.CorpusRetriever._build_vectorizer()
    pmat = vec.fit_transform(parents_canon)
    rvec = brain.CorpusRetriever._build_vectorizer()
    rmat = rvec.fit_transform(replies_norm)

    n = len(survivors)
    isolated = 0
    for start in range(0, n, CHUNK):
        end = min(start + CHUNK, n)
        psim = cosine_similarity(pmat[start:end], pmat)        # (chunk, n)
        rsim = cosine_similarity(rmat[start:end], rmat)        # (chunk, n)
        for row in range(end - start):
            i = start + row
            neigh = np.where(psim[row] >= PARENT_NEIGHBOR_SIM)[0]
            neigh = neigh[neigh != i]
            if neigh.size < MIN_NEIGHBORS:
                continue  # parent too rare to judge -> keep
            if rsim[row][neigh].max() < REPLY_CORROBORATE_SIM:
                pid = survivors[i][0]
                drop_ids.add(pid)
                isolated += 1
                samples.setdefault("isolated-noise", []).append((survivors[i][1], survivors[i][2]))
        print(f"  scanned {end}/{n} survivors…", file=sys.stderr)

    reasons["isolated-noise"] = isolated

    # --- report ------------------------------------------------------------
    kept = total - len(drop_ids)
    print("\n=== cleanup report (dry-run) ===" if not args.apply else "\n=== cleanup report (APPLYING) ===")
    for reason, count in sorted(reasons.items(), key=lambda x: -x[1]):
        print(f"  drop [{reason}]: {count}")
        for p, r in samples.get(reason, [])[:5]:
            print(f"        {p[:45]!r} -> {r[:45]!r}")
    print(f"\n  total pairs:   {total}")
    print(f"  to remove:     {len(drop_ids)}  ({100*len(drop_ids)/max(1,total):.1f}%)")
    print(f"  remaining:     {kept}")

    if not args.apply:
        print("\ndry-run only. re-run with --apply to delete (a backup is made first).")
        conn.close()
        return

    backup = f"{args.db}.bak-{int(time.time())}"
    shutil.copy2(args.db, backup)
    print(f"\nbacked up to {backup}")
    ids = list(drop_ids)
    for s in range(0, len(ids), 900):
        batch = ids[s:s + 900]
        c.execute(f"DELETE FROM pairs WHERE id IN ({','.join('?' * len(batch))})", batch)
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(f"deleted {len(ids)} pairs. done.")


if __name__ == "__main__":
    main()
