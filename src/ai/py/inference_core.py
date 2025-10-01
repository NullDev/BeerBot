import os, json
import random
from collections import deque
import numpy as np
import onnxruntime as ort
import sentencepiece as spm
import kenlm

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

MODEL_DIR = "./data/ai"

LAST_REPLIES = deque(maxlen=10)

KENLM_PATH = os.path.join(MODEL_DIR, "reranker.klm")
lm = kenlm.Model(KENLM_PATH)

sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "spm.model"))
with open(os.path.join(MODEL_DIR, "meta.json"), "r", encoding="utf-8") as f:
    meta = json.load(f)

VOCAB  = meta["vocab"]
MAXLEN = meta["maxlen"]
HIDDEN = meta["hidden_size"]
LAYERS = meta["num_layers"]
PAD    = meta["pad_id"]
BOS    = meta["bos_id"]
EOS    = meta["eos_id"]

# ONNX sessions
enc = ort.InferenceSession(os.path.join(MODEL_DIR, "encoder.onnx"), providers=["CPUExecutionProvider"])
dec = ort.InferenceSession(os.path.join(MODEL_DIR, "decoder.onnx"), providers=["CPUExecutionProvider"])

enc_in_name = enc.get_inputs()[0].name      # "src"
enc_out_encouts = enc.get_outputs()[0].name # "enc_outs"
enc_out_h = enc.get_outputs()[1].name       # "h"
enc_out_c = enc.get_outputs()[2].name       # "c"

dec_in_names = [i.name for i in dec.get_inputs()]   # ["y_prev","h_in","c_in","enc_outs","enc_mask"]
dec_out_names = [o.name for o in dec.get_outputs()] # ["logits","h_out","c_out"]

def softmax_stable(x):
    x = x - np.max(x)
    e = np.exp(x)
    return e / (e.sum() + 1e-12)

def sentence_length_bonus(candidate: str) -> float:
    tokens = candidate.strip().split()
    n = len(tokens)

    # Mild bump for sentence-like replies
    if n >= 5:
        return 1.0  # tuneable base bonus
    elif n >= 3:
        return 0.5
    else:
        return 0.0

def lm_score(text: str) -> float:
    """Score a sentence using the KenLM model. Higher = more fluent."""
    return lm.score(text, bos=True, eos=True)

def seq2seq_log_prob(src_text: str, tgt_text: str) -> float:
    """Compute the log-probability of the target sequence given the source under the Seq2Seq model."""
    # Encode source
    src_ids = np.array([encode_text(src_text)], dtype=np.int64)
    enc_mask = (src_ids != PAD)
    enc_outs, h, c = enc.run(
        [enc_out_encouts, enc_out_h, enc_out_c],
        {enc_in_name: src_ids}
    )

    # Encode target (no BOS)
    tgt_ids = [BOS] + sp.encode(tgt_text, out_type=int)[:MAXLEN-2] + [EOS]
    log_prob = 0.0
    y_prev = np.array([BOS], dtype=np.int64)

    for next_id in tgt_ids[1:]:
        feed = {
            "y_prev": y_prev,
            "h": h,
            "c": c,
            "enc_outs": enc_outs,
            "enc_mask": enc_mask
        }
        logits, h, c = dec.run(dec_out_names, feed)
        logits = np.asarray(logits[0] if logits.ndim > 1 else logits)
        probs = softmax_stable(logits)
        log_prob += np.log(probs[next_id] + 1e-12)
        y_prev = np.array([next_id], dtype=np.int64)

    return float(log_prob)

def combined_score(src_text, candidate, lm_weight=0.3, length_bonus=0.15, repeat_penalty=2.0):
    lm_s = lm_score(candidate)
    model_s = seq2seq_log_prob(src_text, candidate)
    length_s = length_bonus * sentence_length_bonus(candidate)

    # repetition penalty
    if candidate in LAST_REPLIES:
        model_s -= repeat_penalty # big negative hit for repeats

    return lm_weight * lm_s + (1 - lm_weight) * model_s + length_s

def blocked_by_ngrams(candidate_id, out_ids, n=3):
    """Return True if adding candidate would create a repeated n-gram."""
    if len(out_ids) < n - 1:
        return False
    tail = out_ids[-(n-1):] + [int(candidate_id)]
    for i in range(len(out_ids) - n + 1):
        if out_ids[i:i+n] == tail:
            return True
    return False

def generate_candidates(text: str, n: int = 5) -> str:
    """Generate n candidate responses and return the one with the best KenLM score."""
    candidates = []
    for _ in range(n):
        temp = random.uniform(0.6, 0.9)
        top_p = random.uniform(0.8, 0.95)
        top_k = random.randint(20, 50)
        cand = decode_sampled(
            text,
            max_new_tokens=min(MAXLEN, 32),
            top_p=top_p,
            top_k=top_k,
            temperature=temp,
            repetition_penalty=1.20,
            min_len=4
        )
        candidates.append(cand)

    # Score with KenLM and pick the best
    best = max(candidates, key=lambda c: combined_score(text, c, lm_weight=0.3))
    LAST_REPLIES.append(best)
    return best

def apply_repetition_penalty(logits, used_ids, penalty=1.2):
    if not used_ids:
        return logits
    # penalize already used ids
    for tid in set(used_ids):
        logits[tid] = logits[tid] / penalty
    return logits

def sample_top_p_top_k(logits, top_p=0.9, top_k=40, temperature=0.8, disallow=None):
    if temperature <= 0: # safety
        temperature = 1.0
    logits = logits.astype(np.float64) / temperature

    # mask disallowed tokens
    if disallow:
        logits[list(disallow)] = -1e9

    # top-k
    if top_k is not None and top_k > 0 and top_k < logits.shape[-1]:
        idx = np.argpartition(-logits, top_k)[:top_k]
        mask = np.full_like(logits, -1e9)
        mask[idx] = logits[idx]
        logits = mask

    # top-p (nucleus)
    probs = softmax_stable(logits)
    sort_idx = np.argsort(-probs)
    sorted_probs = probs[sort_idx]
    csum = np.cumsum(sorted_probs)
    cutoff = np.searchsorted(csum, top_p, side="left") + 1
    keep_idx = sort_idx[:cutoff]
    keep_probs = probs[keep_idx]
    keep_probs = keep_probs / keep_probs.sum()

    return int(np.random.choice(keep_idx, p=keep_probs))

def encode_text(text: str):
    ids = [BOS] + sp.encode(text, out_type=int)[:MAXLEN-2] + [EOS]
    if len(ids) < MAXLEN:
        ids = ids + [PAD]*(MAXLEN - len(ids))
    else:
        ids = ids[:MAXLEN]
    return ids

def decode_sampled(src_text: str, max_new_tokens: int = 32, top_p=0.9, top_k=40, temperature=0.8, repetition_penalty=1.15, min_len=4):
    # encode once
    src_ids = np.array([encode_text(src_text)], dtype=np.int64) # (1, T)
    enc_mask = (src_ids != PAD) # (1, T)

    enc_outs, h, c = enc.run(
        [enc_out_encouts, enc_out_h, enc_out_c],
        {enc_in_name: src_ids}
    )
    h = h.astype(np.float32) # (L,B,H)
    c = c.astype(np.float32)

    y_prev = np.array([BOS], dtype=np.int64)
    out_ids = []
    disallow = {PAD, BOS} # never sample these

    for step in range(max_new_tokens):
        feed = {
            "y_prev": y_prev,
            "h": h,
            "c": c,
            "enc_outs": enc_outs,
            "enc_mask": enc_mask
        }
        logits, h, c = dec.run(dec_out_names, feed)
        logits = np.asarray(logits)
        # old shape (B,1,V)
        if logits.ndim == 3:   logits = logits[0, 0]
        # new shape (B, V)
        elif logits.ndim == 2: logits = logits[0]
        # already (V,)
        else: logits = logits

        # repetition penalty
        logits = apply_repetition_penalty(logits, out_ids, penalty=repetition_penalty)

        # avoid early EOS
        local_disallow = set(disallow)
        if step < min_len:
            local_disallow.add(EOS)

        work_logits = logits.copy()

        attempts = 0
        while True:
            next_id = sample_top_p_top_k(
                work_logits,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                disallow=local_disallow
            )
            # if this choice would repeat a recent 3-gram, mask it out and resample
            if blocked_by_ngrams(next_id, out_ids, n=3) and attempts < 10:
                work_logits[int(next_id)] = -1e9 # forbid and try again
                attempts += 1
                continue
            break

        # safety clamp
        next_id = max(0, min(next_id, VOCAB - 1))

        if next_id == EOS: break

        out_ids.append(next_id)
        y_prev = np.array([next_id], dtype=np.int64)

    out_ids = [int(x) for x in out_ids]
    return sp.decode(out_ids)

def generate(text: str) -> str:
    return generate_candidates(text, n=10)
