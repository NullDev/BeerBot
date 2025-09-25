import os, json, tempfile
from typing import List, Tuple
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import sentencepiece as spm
import warnings

from t_helpers import Seq2Seq

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

DATA_JSONL = "./data/ai/dataset.jsonl"
MODEL_DIR   = "./data/ai"
os.makedirs(MODEL_DIR, exist_ok=True)

# hyperparams
VOCAB_SIZE = 160000
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
        model_type="bpe",
        character_coverage=1.0,
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

class Chatset(Dataset):
    def __init__(self, pairs: List[Tuple[str, str]], sp: spm.SentencePieceProcessor):
        self.data = []
        self.sp = sp
        self.PAD, self.BOS, self.EOS = sp.pad_id(), sp.bos_id(), sp.eos_id()
        for s, t in pairs:
            src = [self.BOS] + sp.encode(s, out_type=int)[:MAXLEN-2] + [self.EOS]
            tgt = [self.BOS] + sp.encode(t, out_type=int)[:MAXLEN-2] + [self.EOS]
            self.data.append((src, tgt))

    def __len__(self): return len(self.data)
    def __getitem__(self, i): return self.data[i]

def collate(batch, pad_id=0):
    srcs, tgts = zip(*batch)
    maxs = max(len(s) for s in srcs)
    maxt = max(len(t) for t in tgts)
    def pad(x, m): return x + [pad_id]*(m - len(x))
    src = torch.tensor([pad(s, maxs) for s in srcs], dtype=torch.long)
    tgt = torch.tensor([pad(t, maxt) for t in tgts], dtype=torch.long)
    return src, tgt

def main():
    if not os.path.exists(DATA_JSONL):
        raise FileNotFoundError(f"Missing dataset at {DATA_JSONL}")

    pairs = read_pairs(DATA_JSONL)
    if not pairs:
        raise RuntimeError("dataset.jsonl contained no usable (input,target) pairs.")

    sp = build_tokenizer(pairs)
    PAD, BOS, EOS = sp.pad_id(), sp.bos_id(), sp.eos_id()
    vocab_size = sp.get_piece_size()

    dataset = Chatset(pairs, sp)
    loader  = DataLoader(dataset, batch_size=BATCH, shuffle=True, collate_fn=lambda b: collate(b, pad_id=PAD))

    model = Seq2Seq(vocab_size, EMBED, HIDDEN, LAYERS, PAD).to(DEVICE)
    model.dec_train.fc.weight = model.dec_train.emb.weight
    opt   = optim.Adam(model.parameters(), lr=LR)
    crit  = nn.CrossEntropyLoss(ignore_index=PAD, label_smoothing=0.1)

    model.train()
    for ep in range(1, EPOCHS+1):
        tot = 0.0
        for src, tgt in loader:
            src, tgt = src.to(DEVICE), tgt.to(DEVICE)
            dec_in, dec_out = tgt[:, :-1], tgt[:, 1:] # teacher forcing
            logits = model(src, dec_in)               # (B,T,V)
            loss = crit(logits.reshape(-1, vocab_size), dec_out.reshape(-1))
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            opt.step()
            tot += loss.item()
        print(f"Epoch {ep}/{EPOCHS}  loss={tot/len(loader):.4f}")

    # save torch weights for future fine-tuning (?)
    torch.save(model.state_dict(), os.path.join(MODEL_DIR, "model.pt"))

    # export ONNX Encoder: src -> (h, c)
    print("Exporting ONNX (encoder/decoder)...")
    model.eval()
    dummy_src = torch.randint(low=1, high=vocab_size, size=(1, MAXLEN), dtype=torch.long).to(DEVICE)
    h, c = model.enc(dummy_src)

    torch.onnx.export(
        model.enc, (dummy_src,),
        os.path.join(MODEL_DIR, "encoder.onnx"),
        input_names  = ["src"],
        output_names = ["h", "c"],
        dynamic_axes = {
            "src": {0: "B", 1: "T"},
            "h":   {1: "B"},
            "c":   {1: "B"}
        },
        opset_version=17,
        # dynamo=True
    )

    # Export ONNX DecoderStep: (y_prev, h_in, c_in) -> (logits, h_out, c_out)
    dummy_y = torch.randint(low=1, high=vocab_size, size=(1, 1), dtype=torch.long).to(DEVICE)
    dummy_h = torch.zeros(LAYERS, 1, HIDDEN, dtype=torch.float32).to(DEVICE)
    dummy_c = torch.zeros(LAYERS, 1, HIDDEN, dtype=torch.float32).to(DEVICE)

    # tie weights from training decoder to step decoder
    model.dec_step.emb.weight.data.copy_(model.dec_train.emb.weight.data)
    for (n1, p1), (n2, p2) in zip(model.dec_step.lstm.named_parameters(), model.dec_train.lstm.named_parameters()):
        if p1.shape == p2.shape:
            p1.data.copy_(p2.data)
    model.dec_step.fc.weight.data.copy_(model.dec_train.fc.weight.data)
    model.dec_step.fc.bias.data.copy_(model.dec_train.fc.bias.data)

    torch.onnx.export(
        model.dec_step, (dummy_y, dummy_h, dummy_c),
        os.path.join(MODEL_DIR, "decoder.onnx"),
        input_names  = ["y_prev", "h_in", "c_in"],
        output_names = ["logits", "h_out", "c_out"],
        dynamic_axes = {
            "y_prev": {0: "B"}, # (B,1)
            "h_in":   {1: "B"}, # (L,B,H)
            "c_in":   {1: "B"},
            "logits": {0: "B"}, # (B,1,V)
            "h_out":  {1: "B"}, # (L,B,H)
            "c_out":  {1: "B"},
        },
        opset_version=17,
        # dynamo=True
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
