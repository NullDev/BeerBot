import torch.nn as nn

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

class Encoder(nn.Module):
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab, emb, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb, hidden, layers, batch_first=True, dropout=0.2 if layers > 1 else 0.0)

    def forward(self, src):
        e = self.emb(src)        # (B,T,E)
        _, (h, c) = self.lstm(e) # h,c: (L,B,H)
        return h, c

class DecoderSeq(nn.Module):
    """Teacher-forced decoder over a whole target sequence (for training)."""
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab, emb, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb, hidden, layers, batch_first=True, dropout=0.2 if layers > 1 else 0.0)
        self.fc   = nn.Linear(hidden, vocab)

    def forward(self, tgt, h, c):
        e = self.emb(tgt)                # (B,T,E)
        o, (h, c) = self.lstm(e, (h, c)) # o: (B,T,H)
        logits = self.fc(o)              # (B,T,V)
        return logits, (h, c)

class DecoderStep(nn.Module):
    """Single-step decoder for ONNX export & inference (y_prev is 1 token)."""
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab, emb, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb, hidden, layers, batch_first=True, dropout=0.2 if layers > 1 else 0.0)
        self.fc   = nn.Linear(hidden, vocab)

    def forward(self, y_prev, h, c):
        # y_prev: (B,1)
        e = self.emb(y_prev)             # (B,1,E)
        o, (h, c) = self.lstm(e, (h, c)) # o: (B,1,H)
        logits = self.fc(o)              # (B,1,V)
        return logits, h, c

class Seq2Seq(nn.Module):
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.enc = Encoder(vocab, emb, hidden, layers, pad_id)
        self.dec_train = DecoderSeq(vocab, emb, hidden, layers, pad_id)
        self.dec_step  = DecoderStep(vocab, emb, hidden, layers, pad_id)

    def forward(self, src, tgt):
        h, c = self.enc(src)
        logits, _ = self.dec_train(tgt, h, c)
        return logits
