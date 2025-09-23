import MicroMarkov from "./MiniMarkov.js";
import defaultStopwords from "./stopwords.js";
import { Database as BunDB } from "bun:sqlite";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Organic Markov Reply Engine
 * - Conversational memory with reply chains and sequential adjacency
 * - TF-IDF + cosine similarity for retrieval
 * - Markov n-gram fallback
 * - Optional micro-Markov remixing from candidate replies
 *
 * @export
 * @class OrganicMarkov
 */
export class OrganicMarkov {
    /**
     * Creates an instance of OrganicMarkov.
     * @param {Object} [opts]
     * @param {number} [opts.order]
     * @param {boolean} [opts.lowercase]
     * @param {number} [opts.decayHalfLifeMs]
     * @param {number} [opts.maxPairsPerKey]
     * @param {number} [opts.maxVocabulary]
     * @param {Set<string>} [opts.stopwords]
     * @memberof OrganicMarkov
     */
    constructor(opts = {}){
        this.order = Math.max(2, Math.min(4, opts.order ?? 2));
        this.lowercase = opts.lowercase ?? true;
        this.decayHalfLifeMs = opts.decayHalfLifeMs ?? 1000 * 60 * 60 * 24 * 60;
        this.maxPairsPerKey = opts.maxPairsPerKey ?? 50;
        this.maxVocabulary = opts.maxVocabulary ?? 20000;
        this.stopwords = opts.stopwords ?? defaultStopwords;

        this.db = new BunDB("./data/brain.sqlite");
        this.lastMsgByChannel = new Map(); // track last non-bot message for sequential pairing
    }

    async init(){
        this.db.run(`CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            content TEXT,
            authorId TEXT,
            replyToId TEXT,
            ts INTEGER
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parentKey TEXT,
            reply TEXT,
            ts INTEGER
        )`);

        this.db.run(`CREATE TABLE IF NOT EXISTS markov (
            prefix TEXT,
            next TEXT,
            count INTEGER,
            PRIMARY KEY(prefix, next)
        )`);
    }

    /**
     * Learn from a message
     *
     * @param {import("discord.js").Message} msg
     * @return {Promise<void>}
     * @memberof OrganicMarkov
     */
    async learn(msg){
        if (!msg || !msg.id) return;
        const ts = msg.createdTimestamp ?? Date.now();
        const clean = this.cleanText(msg.content);
        if (!clean) return;

        if (msg.channelId){
            const last = this.lastMsgByChannel.get(msg.channelId);
            if (
                last // @ts-ignore
            && last.authorId === msg.authorId // @ts-ignore
            && !msg.replyToId && !last.replyToId
            && (ts - last.ts < 5000)
            ){
            // merge into previous message
                const merged = (last.content + " " + clean).trim();
                this.db.run("UPDATE messages SET content = ?, ts = ? WHERE id = ?", [merged, ts, last.id]);
                this.lastMsgByChannel.set(msg.channelId, { ...last, content: merged, ts });
                return;
            }
        }

        // @ts-ignore
        this.db.run("INSERT OR REPLACE INTO messages (id, content, authorId, replyToId, ts) VALUES (?, ?, ?, ?, ?)", [msg.id, clean, msg.authorId, msg.replyToId ?? null, ts]);

        await this.trainMarkov(clean);

        // @ts-ignore
        if (msg.replyToId){ // @ts-ignore
            const parent = this.db.query("SELECT content FROM messages WHERE id = ?").get(msg.replyToId);
            if (parent){
                const key = this.canonicalKey(parent.content);
                this.addPair(key, clean, ts);
            }
        }
        else if (msg.channelId){
            const last = this.lastMsgByChannel.get(msg.channelId); // @ts-ignore
            if (last && last.authorId !== msg.authorId){
                const key = this.canonicalKey(last.content);
                if (key) this.addPair(key, clean, ts);
            } // @ts-ignore
            this.lastMsgByChannel.set(msg.channelId, { content: clean, authorId: msg.authorId, ts });
        }
    }

    /**
     * Generate a reply sentence
     *
     * @param {string} input
     * @param {Object} [options={}]
     * @return {Promise<string>}
     * @memberof OrganicMarkov
     */
    async generateSentence(input, options = {}){
        const opts = this.withDefaults(options);
        const now = Date.now();
        const query = this.cleanText(input);
        if (!query) return await this.markovSample(null, opts);

        const candidates = this.nearestKeys(query, opts.topK ?? 5);
        let bestKey = null;
        let bestScore = -Infinity;
        for (const { key, score } of candidates){
            const recBoost = this.recencyBoost(key, now, opts.preferRecentMs);
            const finalScore = score + recBoost;
            if (finalScore > bestScore){
                bestScore = finalScore;
                bestKey = key;
            }
        }

        if (bestKey && bestScore >= (opts.similarityThreshold ?? 0.18)){
            const pool = this.db.query("SELECT reply, ts FROM pairs WHERE parentKey = ?").all(bestKey);
            if (pool && pool.length){
                const replies = pool.map(r => r.reply);
                const tsArr = pool.map(r => r.ts);

                // sometimes remix with micro-markov for variety
                if (replies.length >= 3 && Math.random() < 0.4){
                    const micro = new MicroMarkov(this.order);
                    for (const r of replies) micro.train(r);
                    let out = micro.sample(opts.maxLen, opts.temperature);
                    out = this.polish(out, opts);
                    if (out) return out;
                }

                const idx = this.sampleWeightedIndex(replies, tsArr, now);
                let out = replies[idx];
                out = this.polish(out, opts);
                return out;
            }
        }

        return await this.markovSample(query, opts);
    }

    /**
     * Apply default options
     *
     * @param {Object} opts
     * @param {number} [opts.maxLen]
     * @param {number} [opts.minLen]
     * @param {number} [opts.temperature]
     * @param {number} [opts.similarityThreshold]
     * @param {number} [opts.topK]
     * @param {number} [opts.preferRecentMs]
     * @param {boolean} [opts.steerToInput]
     * @param {boolean} [opts.sanitizeMentions]
     * @return {{
     *   maxLen: number, minLen: number, temperature: number, similarityThreshold: number,
     *   topK: number, preferRecentMs: number, steerToInput: boolean, sanitizeMentions: boolean
     * }}
     * @memberof OrganicMarkov
     */
    withDefaults(opts){
        return {
            maxLen: opts.maxLen ?? 160,
            minLen: opts.minLen ?? 5,
            temperature: Math.max(0, Math.min(1, opts.temperature ?? 0.55)),
            similarityThreshold: opts.similarityThreshold ?? 0.18,
            topK: opts.topK ?? 6,
            preferRecentMs: opts.preferRecentMs ?? 1000 * 60 * 60 * 24 * 7,
            steerToInput: opts.steerToInput ?? true,
            sanitizeMentions: opts.sanitizeMentions ?? true,
        };
    }

    /**
     * Clean text for processing
     *
     * @param {string} s
     * @return {string}
     * @memberof OrganicMarkov
     */
    cleanText(s){
        if (!s) return "";
        let t = s;
        t = t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
        t = t.replace(/https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=.]+)?/gi, " ");
        t = t.replace(/<@&?\d+>/g, " ").replace(/<#!?\d+>/g, " ");
        t = t.replace(/[\n\r]+/g, " ").replace(/\s{2,}/g, " ").trim();
        if (this.lowercase) t = t.toLowerCase();
        return t;
    }

    /**
     * Tokenize a string into words, removing stopwords and punctuation
     *
     * @param {string} s
     * @return {string[]}
     * @memberof OrganicMarkov
     */
    tokenize(s){
        const raw = s.replace(/[^\p{L}\p{N}'_\-\s]/gu, " ").replace(/\s{2,}/g, " ").trim().split(/\s+/);
        const toks = [];
        for (const w of raw){
            if (!w) continue;
            const base = w.replace(/^[_'-]+|[_'-]+$/g, "");
            if (!base) continue;
            if (this.stopwords.has(base)) continue;
            toks.push(base);
        }
        return toks;
    }

    /**
     * Get canonical key for a string (tokenized, stopwords removed, joined)
     *
     * @param {string} s
     * @return {string}
     * @memberof OrganicMarkov
     */
    canonicalKey(s){
        return this.tokenize(s).join(" ");
    }

    /**
     * Add a parentKey -> reply pair to the database
     *
     * @param {string} key
     * @param {string} reply
     * @param {number} ts
     * @memberof OrganicMarkov
     */
    addPair(key, reply, ts){
        this.db.run("INSERT INTO pairs (parentKey, reply, ts) VALUES (?, ?, ?)", [key, reply, ts]);
    }

    /**
     * Train the Markov model on given text
     *
     * @param {string} text
     * @return {Promise<void>}
     * @memberof OrganicMarkov
     */
    async trainMarkov(text){
        const toks = this.tokenize(text);
        if (toks.length <= this.order) return;
        const pad = Array(this.order - 1).fill("<s>");
        const seq = [...pad, ...toks, "</s>"];
        for (let i = 0; i + this.order - 1 < seq.length - 1; i++){
            const prefix = seq.slice(i, i + this.order - 1).join("\u0001");
            const next = seq[i + this.order - 1];
            this.db.run(`INSERT INTO markov (prefix, next, count) VALUES (?, ?, 1)
                        ON CONFLICT(prefix, next) DO UPDATE SET count = count + 1`, [prefix, next]);
        }
    }

    /**
     * Sample a sentence from the Markov model
     *
     * @param {string|null} seed
     * @param {Object} opts
     * @param {number} opts.maxLen
     * @param {number} opts.minLen
     * @param {number} opts.temperature
     * @param {boolean} opts.steerToInput
     * @param {boolean} opts.sanitizeMentions
     * @return {Promise<string>}
     * @memberof OrganicMarkov
     */
    async markovSample(seed, opts){
        let prefixTokens = [];
        if (seed && opts.steerToInput){
            const toks = this.tokenize(seed);
            for (let k = this.order - 1; k >= 1; k--){
                const pre = toks.slice(-k).join("\u0001");
                const row = this.db.query("SELECT next, count FROM markov WHERE prefix = ?").all(pre);
                if (row.length){
                    prefixTokens = toks.slice(-k);
                    break;
                }
            }
        }
        if (!prefixTokens.length) prefixTokens = Array(this.order - 1).fill("<s>");

        const acc = [];
        const maxSteps = 64;
        for (let steps = 0; steps < maxSteps; steps++){
            const key = prefixTokens.join("\u0001");
            const row = this.db.query("SELECT next, count FROM markov WHERE prefix = ?").all(key);
            if (!row.length) break;
            const next = this.sampleRow(row, opts.temperature);
            if (!next || next === "</s>") break;
            if (next !== "<s>") acc.push(next);
            prefixTokens = [...prefixTokens.slice(1), next];
            if (acc.join(" ").length >= opts.maxLen) break;
        }
        let out = acc.join(" ");

        // rare word steering
        if (opts.steerToInput && seed){
            const inToks = this.tokenize(seed);
            const rare = inToks.filter(w => {
                const {df} = this.db.query("SELECT COUNT(DISTINCT parentKey) as df FROM pairs WHERE parentKey LIKE ?").get(`%${w}%`);
                return df < 2;
            });
            if (rare.length && Math.random() < 0.5){
                const pick = rare[Math.floor(Math.random() * rare.length)];
                if (!out.includes(pick)) out = out + " " + pick;
            }
        }

        return this.polish(out, opts);
    }

    /**
     * Polish output text (trim, punctuation, length, mentions)
     *
     * @param {string} out
     * @param {Object} opts
     * @param {number} opts.minLen
     * @param {number} opts.maxLen
     * @param {boolean} opts.sanitizeMentions
     * @return {string}
     * @memberof OrganicMarkov
     */
    polish(out, opts){
        let t = out.trim();
        if (!t) return "";
        if (!/[.!?…]$/.test(t)) t += ".";
        if (opts.sanitizeMentions){
            t = t.replace(/@everyone|@here/g, "everyone");
            t = t.replace(/<@&?\d+>/g, "");
            t = t.replace(/<#!?\d+>/g, "");
            t = t.replace(/<@!?(\d+)>/g, (_, id) => `@u${String(id).slice(-4)}`);
        }
        if (t.length < opts.minLen){
            const extra = this.db.query("SELECT next FROM markov ORDER BY RANDOM() LIMIT 1").get()?.next;
            if (extra) t = (t + " " + extra).trim();
        }
        if (t.length > opts.maxLen) t = t.slice(0, opts.maxLen - 1) + "…";
        return t;
    }

    /**
     * Find nearest keys to a query using TF-IDF + cosine similarity
     *
     * @param {string} query
     * @param {number} topK
     * @return {Array<{key: string, score: number}>}
     * @memberof OrganicMarkov
     */
    nearestKeys(query, topK){
        const qToks = this.tokenize(query);
        if (!qToks.length) return [];
        const qTf = this.termFreq(qToks);
        const qVec = new Map();
        for (const [term, tf] of qTf){
            const idf = this.idf(term);
            if (idf <= 0) continue;
            qVec.set(term, tf * idf);
        }
        const qNorm = this.vecNorm(qVec);
        if (qNorm === 0) return [];

        const rows = this.db.query("SELECT DISTINCT parentKey FROM pairs").all();
        const out = [];
        for (const r of rows){
            const dToks = this.tokenize(r.parentKey);
            const dTf = this.termFreq(dToks);
            let dot = 0;
            let dSq = 0;
            for (const [term, tf] of dTf){
                const idf = this.idf(term);
                if (idf <= 0) continue;
                const w = tf * idf;
                dSq += w * w;
                const qv = qVec.get(term);
                if (qv) dot += qv * w;
            }
            const denom = Math.sqrt(dSq) * qNorm;
            if (denom === 0) continue;
            const score = dot / denom;
            if (score > 0) out.push({ key: r.parentKey, score });
        }
        out.sort((a, b)=>b.score - a.score);
        return out.slice(0, topK);
    }

    /**
     * Inverse Document Frequency for a term
     *
     * @param {string} term
     * @return {number}
     * @memberof OrganicMarkov
     */
    idf(term){
        const dfRow = this.db.query("SELECT COUNT(DISTINCT parentKey) as df FROM pairs WHERE parentKey LIKE ?").get(`%${term}%`);
        const df = dfRow ? dfRow.df : 0;
        if (df === 0) return 0;
        const totalDocs = this.db.query("SELECT COUNT(DISTINCT parentKey) as c FROM pairs").get().c;
        return Math.log((totalDocs + 1) / (df + 0.5));
    }

    /**
     * Term Frequency for a list of tokens
     *
     * @param {string[]} tokens
     * @return {Map<string, number>}
     * @memberof OrganicMarkov
     */
    termFreq(tokens){
        const m = new Map();
        for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
        for (const [k, v] of m) m.set(k, 1 + Math.log(v));
        return m;
    }

    /**
     * Vector norm (magnitude) of a term vector
     *
     * @param {Map<string, number>} vec
     * @return {number}
     * @memberof OrganicMarkov
     */
    vecNorm(vec){
        let s = 0;
        for (const v of vec.values()) s += v * v;
        return Math.sqrt(s);
    }

    /**
     * Recency boost for a key based on latest usage timestamp
     *
     * @param {string} key
     * @param {number} now
     * @param {number} windowMs
     * @return {number}
     * @memberof OrganicMarkov
     */
    recencyBoost(key, now, windowMs){
        const row = this.db.query("SELECT ts FROM pairs WHERE parentKey = ? ORDER BY ts DESC LIMIT 1").get(key);
        if (!row) return 0;
        const latest = row.ts;
        if (!windowMs) return 0;
        const age = now - latest;
        if (age <= 0) return 0.05;
        const frac = Math.max(0, 1 - age / windowMs);
        return 0.05 * frac;
    }

    /**
     * Sample a next word from a row of (next, count) entries using temperature
     *
     * @param {Array<{next: string, count: number}>} row
     * @param {number} [temperature=0.5]
     * @return {string|null}
     * @memberof OrganicMarkov
     */
    sampleRow(row, temperature = 0.5){
        if (!row.length) return null;
        const pow = (/** @type {number} */ x) => Math.pow(x, 1 / Math.max(0.05, temperature));
        const weights = row.map(r=>pow(r.count));
        const sum = weights.reduce((a, b)=>a + b, 0);
        let r = Math.random() * sum;
        for (let i = 0; i < row.length; i++){
            r -= weights[i];
            if(r <= 0) return row[i].next;
        }
        return row[row.length - 1].next;
    }

    /**
     * Sample an index from replies weighted by recency and length
     *
     * @param {string[]} replies
     * @param {number[]} ts
     * @param {number} now
     * @return {number}
     * @memberof OrganicMarkov
     */
    sampleWeightedIndex(replies, ts, now){
        const weights = [];
        const halfLife = this.decayHalfLifeMs;
        for(let i = 0; i < replies.length; i++){
            const age = Math.max(0, now - (ts[i] ?? now));
            const decay = Math.pow(0.5, age / halfLife);
            const lenBoost = Math.min(1.5, Math.sqrt(Math.max(5, replies[i].length)) / 8);
            weights.push(1e-3 + decay * lenBoost);
        }
        const sum = weights.reduce((a, b)=>a + b, 0);
        let r = Math.random() * sum;
        for(let i = 0; i < weights.length; i++){
            r -= weights[i];
            if(r <= 0) return i;
        }
        return Math.floor(Math.random() * replies.length);
    }
}
