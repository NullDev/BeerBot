import os, json, tempfile
from typing import List, Tuple
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import sentencepiece as spm
import warnings

from train_helpers import Seq2Seq, Chatset

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

DATA_JSONL = "./data/ai/dataset.jsonl"
MODEL_DIR   = "./data/ai"
os.makedirs(MODEL_DIR, exist_ok=True)

# hyperparams
VOCAB_SIZE = 8000
MAXLEN     = 32
EMBED      = 256
HIDDEN     = 256
LAYERS     = 2
BATCH      = 32
EPOCHS     = 50
LR         = 1e-3
DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"

# ignore lol
warnings.filterwarnings("ignore", message="Exporting a model to ONNX with a batch_size other than 1, with a variable length with LSTM")
warnings.filterwarnings("ignore", message="You are using the legacy TorchScript-based ONNX export. Starting in PyTorch 2.9,")

# utils
def read_pairs(path: str) -> List[Tuple[str, str]]:
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            ex = json.loads(line)
            src = (ex.get("input") or "").strip()
            tgt = (ex.get("target") or "").strip()
            if src and tgt:
                out.append((src, tgt))
    return out

def write_spm_corpus(pairs: List[Tuple[str, str]]) -> str:
    # train SPM on raw text
    tmp = tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", suffix=".txt")
    for s, t in pairs:
        tmp.write(s.strip() + "\n")
        tmp.write(t.strip() + "\n")
    tmp.flush()
    tmp.close()
    return tmp.name

def build_tokenizer(pairs: List[Tuple[str, str]]):
    # yeet old artifacts
    for f in ["spm.model", "spm.vocab", "encoder.onnx", "decoder.onnx", "meta.json", "model.pt"]:
        try: os.remove(os.path.join(MODEL_DIR, f))
        except FileNotFoundError: pass

    print("Training SentencePiece tokenizer...")
    corpus = write_spm_corpus(pairs)
    spm.SentencePieceTrainer.Train(
        input=corpus,
        model_prefix=os.path.join(MODEL_DIR, "spm"),
        vocab_size=VOCAB_SIZE,
        model_type="unigram",
        character_coverage=0.9995,
        # explicit special IDs (PAD=0, UNK=1, BOS=2, EOS=3)
        pad_id=0, unk_id=1, bos_id=2, eos_id=3,
        pad_piece="<pad>", unk_piece="<unk>", bos_piece="<s>", eos_piece="</s>",
        user_defined_symbols=[],
        hard_vocab_limit=False,
        minloglevel=2
    )
    os.remove(corpus)
    sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "spm.model"))
    return sp

def collate(batch, pad_id):
    srcs, tgts = zip(*batch)
    maxs = max(len(s) for s in srcs)
    maxt = max(len(t) for t in tgts)

    def pad_to(x, m): return x + [pad_id] * (m - len(x))

    src = torch.tensor([pad_to(s, maxs) for s in srcs], dtype=torch.long)
    tgt = torch.tensor([pad_to(t, maxt) for t in tgts], dtype=torch.long)

    src_mask = (src != pad_id) # (B, T_src) bool
    return src, tgt, src_mask

def main():
    if not os.path.exists(DATA_JSONL):
        raise FileNotFoundError(f"Missing dataset at {DATA_JSONL}")

    pairs = read_pairs(DATA_JSONL)
    if not pairs:
        raise RuntimeError("dataset.jsonl contained no usable (input,target) pairs.")

    sp = build_tokenizer(pairs)
    PAD, BOS, EOS = sp.pad_id(), sp.bos_id(), sp.eos_id()
    vocab_size = sp.get_piece_size()

    dataset = Chatset(pairs, sp, MAXLEN)
    loader = DataLoader(dataset, batch_size=BATCH, shuffle=True, collate_fn=lambda b: collate(b, pad_id=PAD))

    model = Seq2Seq(vocab_size, EMBED, HIDDEN, LAYERS, PAD).to(DEVICE)
    opt = optim.Adam(model.parameters(), lr=LR)

    model.train()
    for ep in range(1, EPOCHS+1):
        tot = 0.0
        for src, tgt, src_mask in loader:
            src, tgt, src_mask = src.to(DEVICE), tgt.to(DEVICE), src_mask.to(DEVICE)
            tgt_in = tgt[:, :-1]
            tgt_out = tgt[:, 1:]
            logits = model(src, src_mask, tgt_in) # (B, T_dec, V)
            loss = nn.functional.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                tgt_out.reshape(-1),
                ignore_index=PAD,
                label_smoothing=0.1  # Encourage diversity, reduce overconfidence
            )
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            opt.step()
            tot += loss.item()
        print(f"Epoch {ep}/{EPOCHS}  loss={tot/len(loader):.4f}")

    # export ONNX Encoder: src -> (h, c)
    print("Exporting ONNX (encoder/decoder)...")
    model = model.to("cpu").eval()

    # save torch weights for future fine-tuning (?)
    torch.save(model.state_dict(), os.path.join(MODEL_DIR, "model.pt"))

    dummy_src = torch.randint(0, vocab_size, (1, 8), dtype=torch.long)
    enc_outs, h, c = model.enc(dummy_src)

    torch.onnx.export(
        model.enc, (dummy_src,),
        os.path.join(MODEL_DIR, "encoder.onnx"),
        input_names=["src"],
        output_names=["enc_outs", "h", "c"],
        dynamic_axes={
            "src": {0: "B", 1: "Tsrc"},
            "enc_outs": {0: "B", 1: "Tsrc"},
            "h": {1: "B"},
            "c": {1: "B"},
        },
        opset_version=17
    )

    # Export ONNX DecoderStep: (y_prev, h_in, c_in) -> (logits, h_out, c_out)
    dummy_y   = torch.zeros(1, dtype=torch.long)
    dummy_h   = torch.zeros_like(h)
    dummy_c   = torch.zeros_like(c)
    dummy_outs= torch.zeros_like(enc_outs)
    dummy_msk = torch.ones((1, enc_outs.size(1)), dtype=torch.bool)

    # tie weights from training decoder to step decoder
    model.dec_step.emb.weight.data.copy_(model.dec_train.emb.weight.data)
    for (_, p1), (_, p2) in zip(model.dec_step.lstm.named_parameters(), model.dec_train.lstm.named_parameters()):
        if p1.shape == p2.shape:
            p1.data.copy_(p2.data)

    # tie attention Wa
    model.dec_step.attn.Wa.weight.data.copy_(model.dec_train.attn.Wa.weight.data)

    # tie fuse and output projection
    model.dec_step.fuse.weight.data.copy_(model.dec_train.fuse.weight.data)
    model.dec_step.fuse.bias.data.copy_(model.dec_train.fuse.bias.data)
    model.dec_step.fc_vocab.weight.data.copy_(model.dec_train.fc_vocab.weight.data)
    model.dec_step.fc_vocab.bias.data.copy_(model.dec_train.fc_vocab.bias.data)

    torch.onnx.export(
        model.dec_step,
        (dummy_y, dummy_h, dummy_c, dummy_outs, dummy_msk),
        os.path.join(MODEL_DIR, "decoder.onnx"),
        input_names=["y_prev", "h", "c", "enc_outs", "enc_mask"],
        output_names=["logits", "h_out", "c_out"],
        dynamic_axes={
            "y_prev": {0: "B"},
            "h": {1: "B"},
            "c": {1: "B"},
            "enc_outs": {0: "B", 1: "Tsrc"},
            "enc_mask": {0: "B", 1: "Tsrc"},
            "logits": {0: "B"},
            "h_out": {1: "B"},
            "c_out": {1: "B"},
        },
        opset_version=17
    )

    # meta for inference
    with open(os.path.join(MODEL_DIR, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "vocab": vocab_size,
            "maxlen": MAXLEN,
            "hidden_size": HIDDEN,
            "num_layers": LAYERS,
            "pad_id": PAD,
            "bos_id": BOS,
            "eos_id": EOS
        }, f, ensure_ascii=False, indent=2)

    print("Training + clean ONNX export done")

if __name__ == "__main__":
    main()
