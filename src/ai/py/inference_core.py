import os, json
import numpy as np
import onnxruntime as ort
import sentencepiece as spm

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

MODEL_DIR = "./data/ai"

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

def blocked_by_ngrams(candidate_id, out_ids, n=3):
    """Return True if adding candidate would create a repeated n-gram."""
    if len(out_ids) < n - 1:
        return False
    tail = out_ids[-(n-1):] + [int(candidate_id)]
    for i in range(len(out_ids) - n + 1):
        if out_ids[i:i+n] == tail:
            return True
    return False

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
    return decode_sampled(
        text,
        max_new_tokens=min(MAXLEN, 32),
        top_p=0.90,              # 0.92
        top_k=30,                # 50
        temperature=0.7,         # 0.9
        repetition_penalty=1.20, # 1.12
        min_len=4
    )
