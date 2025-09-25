import os, json
import numpy as np
import onnxruntime as ort
import sentencepiece as spm

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

MODEL_DIR = "./data/ai"

# load tokenizer + meta
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

enc_in_name = enc.get_inputs()[0].name  # "src"
enc_out_h   = enc.get_outputs()[0].name # "h"
enc_out_c   = enc.get_outputs()[1].name # "c"

dec_in_names  = [i.name for i in dec.get_inputs()]  # ["y_prev","h_in","c_in"]
dec_out_names = [o.name for o in dec.get_outputs()] # ["logits","h_out","c_out"]

# decoding helpers
def softmax_stable(x):
    x = x - np.max(x)
    e = np.exp(x)
    return e / (e.sum() + 1e-12)

def apply_repetition_penalty(logits, used_ids, penalty=1.2):
    if not used_ids:
        return logits
    # penalize already used ids
    for tid in set(used_ids):
        logits[tid] = logits[tid] / penalty
    return logits

def sample_top_p_top_k(logits, top_p=0.9, top_k=40, temperature=0.8, disallow=None):
    if temperature <= 0:  # safety
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
    h, c = enc.run([enc_out_h, enc_out_c], {enc_in_name: src_ids})
    h = h.astype(np.float32) # (L,B,H)
    c = c.astype(np.float32)

    y_prev = np.array([[BOS]], dtype=np.int64)
    out_ids = []
    disallow = {PAD, BOS} # never sample these

    for step in range(max_new_tokens):
        feed = {"y_prev": y_prev, "h_in": h, "c_in": c}
        logits, h, c = dec.run(dec_out_names, feed)
        logits = logits[0, 0] # (V,)

        # repetition penalty
        logits = apply_repetition_penalty(logits, out_ids, penalty=repetition_penalty)

        # avoid early EOS
        local_disallow = set(disallow)
        if step < min_len:
            local_disallow.add(EOS)

        next_id = sample_top_p_top_k(
            logits,
            top_p=top_p,
            top_k=top_k,
            temperature=temperature,
            disallow=local_disallow
        )

        # safety clamp
        next_id = max(0, min(next_id, VOCAB - 1))

        if next_id == EOS:
            break

        out_ids.append(next_id)
        y_prev = np.array([[next_id]], dtype=np.int64)

    out_ids = [int(x) for x in out_ids]
    return sp.decode(out_ids)

def decode_beam(src_text: str, max_new_tokens=32, beam_size=5, length_penalty=0.7):
    src_ids = np.array([encode_text(src_text)], dtype=np.int64)
    h, c = enc.run([enc_out_h, enc_out_c], {enc_in_name: src_ids})
    h, c = h.astype(np.float32), c.astype(np.float32)

    beams = [(0.0, [BOS], h, c)]
    completed = []

    for _ in range(max_new_tokens):
        new_beams = []
        for score, seq, h, c in beams:
            if seq[-1] == EOS:
                completed.append((score, seq))
                continue

            y_prev = np.array([[seq[-1]]], dtype=np.int64)
            feed = {"y_prev": y_prev, "h_in": h, "c_in": c}
            logits, h_new, c_new = dec.run(dec_out_names, feed)
            logits = logits[0, 0]
            probs = softmax_stable(logits)

            topk_ids = np.argsort(-probs)[:beam_size]
            for tid in topk_ids:
                new_score = score + np.log(probs[tid] + 1e-12)
                new_beams.append((new_score, seq + [tid], h_new, c_new))

        beams = sorted(new_beams, key=lambda x: x[0] / (len(x[1])**length_penalty), reverse=True)[:beam_size]
        if not beams:
            break

    completed.extend([(s, seq) for s, seq, _, _ in beams])
    best = max(completed, key=lambda x: x[0] / (len(x[1])**length_penalty))
    out_ids = best[1][1:] # drop BOS
    if EOS in out_ids:
        out_ids = out_ids[:out_ids.index(EOS)]

    # ensure Python list of ints
    out_ids = [int(x) for x in out_ids]

    return sp.decode(out_ids)

def generate(text: str, method="sample") -> str:
    if method == "beam":
        return decode_beam(text, max_new_tokens=min(MAXLEN, 32))
    return decode_sampled(
        text,
        max_new_tokens=min(MAXLEN, 32),
        top_p=0.92,
        top_k=50,
        temperature=0.9,
        repetition_penalty=1.12,
        min_len=3
    )

if __name__ == "__main__":
    try:
        while True:
            s = input("Input: ").strip()
            if not s:
                print("Bot:")
                continue
            # 10% chance for sample, 90% beam
            if np.random.rand() < 0.1:
                print("Bot (S):", generate(s, method="sample"))
            else:
                print("Bot (B):", generate(s, method="beam"))
            print("")
    except (EOFError, KeyboardInterrupt):
        pass
