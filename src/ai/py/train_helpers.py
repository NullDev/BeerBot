from typing import List, Tuple
import torch
from torch.utils.data import Dataset
import torch.nn as nn
import sentencepiece as spm

# ========================= #
# = Copyright (c) NullDev = #
# ========================= #

class Encoder(nn.Module):
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab, emb, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb, hidden, layers, batch_first=True, dropout=0.2 if layers > 1 else 0.0)

    def forward(self, src):
        e = self.emb(src)               # (B,T,E)
        enc_outs, (h, c) = self.lstm(e) # enc_outs: (B,T,H)
        return enc_outs, h, c           # return o too

class DecoderSeq(nn.Module):
    def __init__(self, vocab_size, emb_size, hidden_size, num_layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, emb_size, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb_size, hidden_size, num_layers, batch_first=True, dropout=0.2 if num_layers > 1 else 0.0)
        self.attn = LuongAttention(hidden_size)
        # combine [dec_h; ctx] -> fused hidden, then project to vocab
        self.fuse = nn.Linear(hidden_size * 2, hidden_size)
        self.dropout = nn.Dropout(0.1)
        self.fc_vocab = nn.Linear(hidden_size, vocab_size)

    @torch.no_grad()
    def step_no_grad(self, *args, **kwargs):
        return self.forward(*args, **kwargs)

    def forward(self, tgt_in, h, c, enc_outs, enc_mask):
        """
        tgt_in:   (B, T_dec) int64, teacher-forced inputs (usually BOS + target[:-1])
        h, c:     initial decoder states from encoder
        enc_outs: (B, T_enc, H) encoder time-step outputs
        enc_mask: (B, T_enc) bool mask (True for real tokens)
        returns:
            logits: (B, T_dec, V)
            (h, c): final states
        """
        _, T = tgt_in.size()
        e = self.emb(tgt_in) # (B, T, E)

        logits_steps = []
        hx, cx = h, c
        for t in range(T):
            xt = e[:, t:t+1, :]                   # (B,1,E)
            o, (hx, cx) = self.lstm(xt, (hx, cx)) # o: (B,1,H)
            dec_h = o.squeeze(1)                  # (B,H)

            ctx, _ = self.attn(dec_h, enc_outs, enc_mask) # (B,H)
            fused = torch.tanh(self.fuse(torch.cat([dec_h, ctx], dim=1))) # (B,H)
            fused = self.dropout(fused)
            logit_t = self.fc_vocab(fused)            # (B,V)
            logits_steps.append(logit_t.unsqueeze(1)) # (B,1,V)

        logits = torch.cat(logits_steps, dim=1)       # (B,T,V)
        return logits, (hx, cx)

class DecoderStep(nn.Module):
    def __init__(self, vocab_size, emb_size, hidden_size, num_layers, pad_id):
        super().__init__()
        self.emb = nn.Embedding(vocab_size, emb_size, padding_idx=pad_id)
        self.lstm = nn.LSTM(emb_size, hidden_size, num_layers, batch_first=True, dropout=0.0) # typically 0 at inference
        self.attn = LuongAttention(hidden_size)
        self.fuse = nn.Linear(hidden_size * 2, hidden_size)
        self.fc_vocab = nn.Linear(hidden_size, vocab_size)

    def forward(self, y_prev, h, c, enc_outs, enc_mask):
        """
        y_prev:   (B,) int64 previous token ids
        h, c:     current decoder states
        enc_outs: (B, T_enc, H)
        enc_mask: (B, T_enc) bool
        returns:
            logits: (B, V) for next token
            h, c:   updated states
        """
        e = self.emb(y_prev).unsqueeze(1) # (B,1,E)
        o, (h, c) = self.lstm(e, (h, c))  # o: (B,1,H)
        dec_h = o.squeeze(1)              # (B,H)

        ctx, _ = self.attn(dec_h, enc_outs, enc_mask) # (B,H)
        fused = torch.tanh(self.fuse(torch.cat([dec_h, ctx], dim=1))) # (B,H)
        logits = self.fc_vocab(fused) # (B,V)
        return logits, h, c

class Seq2Seq(nn.Module):
    def __init__(self, vocab, emb, hidden, layers, pad_id):
        super().__init__()
        self.enc = Encoder(vocab, emb, hidden, layers, pad_id)
        self.dec_train = DecoderSeq(vocab, emb, hidden, layers, pad_id)
        self.dec_step  = DecoderStep(vocab, emb, hidden, layers, pad_id)

    def forward(self, src, src_mask, tgt_in):
        enc_outs, h, c = self.enc(src)
        logits, _ = self.dec_train(tgt_in, h, c, enc_outs, src_mask)
        return logits

class LuongAttention(nn.Module):
    def __init__(self, hidden):
        super().__init__()
        self.Wa = nn.Linear(hidden, hidden, bias=False)

    def forward(self, dec_h_t, enc_outs, enc_mask):
        # dec_h_t: (B,H) current decoder hidden (top layer)
        # enc_outs: (B,T,H)
        # enc_mask: (B,T) 1 for tokens, 0 for pad
        # score_t = (dec_h_t W_a) * enc_outs
        score = torch.bmm(enc_outs, self.Wa(dec_h_t).unsqueeze(2)).squeeze(2) # (B,T)
        score = score.masked_fill(~enc_mask, float('-inf'))
        attn = torch.softmax(score, dim=1)                      # (B,T)
        ctx = torch.bmm(attn.unsqueeze(1), enc_outs).squeeze(1) # (B,H)
        return ctx, attn

class Chatset(Dataset):
    def __init__(self, pairs: List[Tuple[str, str]], sp: spm.SentencePieceProcessor, MAXLEN: int):
        self.data = []
        self.sp = sp
        self.PAD, self.BOS, self.EOS = sp.pad_id(), sp.bos_id(), sp.eos_id()
        for s, t in pairs:
            src = [self.BOS] + sp.encode(s, out_type=int)[:MAXLEN-2] + [self.EOS]
            tgt = [self.BOS] + sp.encode(t, out_type=int)[:MAXLEN-2] + [self.EOS]
            self.data.append((src, tgt))

    def __len__(self): return len(self.data)
    def __getitem__(self, i): return self.data[i]
