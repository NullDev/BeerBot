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
     * @param {Set<string>} [opts.stopwords]
     * @param {number} [opts.lookbackWindow]
     * @memberof OrganicMarkov
     */
    constructor(opts = {}){
        this.order = Math.max(2, Math.min(4, opts.order ?? 2));
        this.lowercase = opts.lowercase ?? true;
        this.stopwords = opts.stopwords ?? defaultStopwords;
        this.lookbackWindow = opts.lookbackWindow ?? 5;

        this.db = new BunDB("./data/brain.sqlite");
        this.lastMsgByChannel = new Map(); // track last non-bot message for sequential pairing
    }

    async init(){
        this.db.run(`CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            channelId TEXT,
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

        this.db.run(
            "INSERT OR REPLACE INTO messages (id, channelId, content, authorId, replyToId, ts) VALUES (?, ?, ?, ?, ?, ?)", // @ts-ignore
            [msg.id, msg.channelId, clean, msg.authorId, msg.replyToId ?? null, ts],
        );

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
            const rows = this.db.query(
                "SELECT id, content, authorId, ts FROM messages WHERE channelId = ? ORDER BY ts DESC LIMIT ?",
            ).all(msg.channelId, this.lookbackWindow);

            let best = null;
            let bestScore = 0;
            const queryToks = this.tokenize(clean);
            const qTf = this.termFreq(queryToks);
            const qVec = new Map();
            for (const [term, tf] of qTf){
                const idf = this.idf(term);
                if (idf > 0) qVec.set(term, tf * idf);
            }
            const qNorm = this.vecNorm(qVec);

            for (const r of rows){ // @ts-ignore
                if (r.authorId === msg.authorId) continue; // skip self
                const dToks = this.tokenize(r.content);
                const dTf = this.termFreq(dToks);
                let dot = 0; let dSq = 0;
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
                if (score > bestScore){
                    bestScore = score;
                    best = r;
                }
            }

            if (best){
                const key = this.canonicalKey(best.content);
                if (key) this.addPair(key, clean, ts);
            }
            // @ts-ignore
            this.lastMsgByChannel.set(msg.channelId, { id: msg.id, content: clean, authorId: msg.authorId, ts });
        }
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
        t = t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " "); // code blocks
        t = t.replace(/https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=.]+)?/gi, " "); // URLs
        t = t.replace(/<@&?\d+>/g, " ").replace(/<#!?\d+>/g, " "); // mentions
        t = t.replace(/<a?:\w+:\d+>/g, " "); // custom emoji
        t = t.replace(/[\n\r]+/g, " ").replace(/\s{2,}/g, " ").trim(); // whitespace
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
     * Seed the database with initial conversational pairs
     *
     * @param {Array<{input: string, reply: string}>} seedData
     * @return {Promise<void>}
     * @memberof OrganicMarkov
     */
    async seedDatabase(seedData){
        const ts = Date.now();
        for (const pair of seedData){
            const cleanIn = this.cleanText(pair.input);
            const cleanOut = this.cleanText(pair.reply);
            if (!cleanIn || !cleanOut) continue;

            const inId = "seed_in_" + cleanIn;
            const outId = "seed_out_" + cleanOut;

            this.db.run(
                "INSERT OR REPLACE INTO messages (id, channelId, content, authorId, replyToId, ts) VALUES (?, ?, ?, ?, ?, ?)",
                [inId, "seed", cleanIn, "seed", null, ts],
            );
            this.db.run(
                "INSERT OR REPLACE INTO messages (id, channelId, content, authorId, replyToId, ts) VALUES (?, ?, ?, ?, ?, ?)",
                [outId, "seed", cleanOut, "seed", inId, ts],
            );

            const key = this.canonicalKey(cleanIn);
            this.addPair(key, cleanOut, ts);
            await this.trainMarkov(cleanIn);
            await this.trainMarkov(cleanOut);
        }
    }
}
