import { Database as BunDB } from "bun:sqlite";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

// Question markers (German + Austrian dialect).
const QUESTION_WORDS = [
    "warum", "wieso", "weshalb", "weshoib", "wie", "wia", "wer", "wea",
    "wo", "was", "wos", "wann", "wem", "wen", "wessen", "wieviel",
    "welche", "welcher", "welches", "gell", "oder", "oda", "ob",
    "kann", "konn", "kannst", "konnst", "soll", "muss",
];

/**
 * Learn user sentences from chat
 * - Conversational memory with reply chains and adjacency filtering
 *
 * @export
 * @class MessageLearner
 */
export class MessageLearner {
    /**
     * Creates an instance of MessageLearner.
     * @param {Object} [opts]
     * @param {number} [opts.lookbackWindow]
     * @param {string} [opts.dbPath] override the SQLite path (e.g. ":memory:" for tests)
     * @memberof MessageLearner
     */
    constructor(opts = {}){
        this.lookbackWindow = opts.lookbackWindow ?? 5;
        this.db = new BunDB(opts.dbPath ?? "./data/brain.sqlite");
        this.lastMsgByChannel = new Map(); // track last non-bot message for sequential pairing
    }

    async init(){
        // WAL lets the Python brain read while this JS learner writes,
        // without the two processes blocking each other.
        this.db.run("PRAGMA journal_mode = WAL");
        this.db.run("PRAGMA synchronous = NORMAL");

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
    }

    /**
     * Clean text for processing
     *
     * @param {string} s
     * @return {string}
     * @memberof MessageLearner
     */
    cleanText(s){
        if (!s) return "";
        let t = s;
        t = t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " "); // code blocks
        t = t.replace(/https?:\/\/[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=.]+)?/gi, " "); // URLs
        t = t.replace(/<@&?\d+>/g, " ").replace(/<#!?\d+>/g, " "); // mentions
        t = t.replace(/<a?:\w+:\d+>/g, " "); // custom emoji
        t = t.replace(/[\n\r]+/g, " ").replace(/\s{2,}/g, " ").trim(); // whitespace
        return t.toLowerCase();
    }

    /**
     * Tokenize cleaned text into words.
     *
     * @param {string} s
     * @return {Array<string>}
     * @memberof MessageLearner
     */
    tokenize(s){
        return this.cleanText(s).split(/\s+/).filter(Boolean);
    }

    /**
     * Check if a message looks like a question.
     *
     * @param {string} s
     * @return {boolean}
     * @memberof MessageLearner
     */
    isQuestion(s){
        const parts = new Set(this.tokenize(s));
        return (s || "").includes("?") || QUESTION_WORDS.some(w => parts.has(w));
    }

    /**
     * Jaccard lexical overlap between two strings (token sets).
     *
     * @param {string} a
     * @param {string} b
     * @return {number}
     * @memberof MessageLearner
     */
    lexicalOverlap(a, b){
        const aa = new Set(this.tokenize(a));
        const bb = new Set(this.tokenize(b));
        if (!aa.size || !bb.size) return 0;
        let inter = 0;
        for (const x of aa){
            if (bb.has(x)) inter++;
        }
        const union = new Set([...aa, ...bb]).size;
        return union ? inter / union : 0;
    }

    /**
     * Keep adjacency, but filter out obviously unrelated parent-child pairs.
     * This stops the bot from learning "random message A -> unrelated message B"
     * just because they happened to be next to each other.
     *
     * @param {string} parent
     * @param {string} reply
     * @param {number} dtMs time gap between parent and reply
     * @returns {boolean}
     * @memberof MessageLearner
     */
    shouldPairAdjacent(parent, reply, dtMs){
        const p = this.cleanText(parent);
        const r = this.cleanText(reply);
        if (!p || !r) return false;
        if (p === r) return false;

        const pt = this.tokenize(p);
        const rt = this.tokenize(r);
        if (!pt.length || !rt.length) return false;

        const overlap = this.lexicalOverlap(p, r);
        const parentQuestion = this.isQuestion(parent);

        // strongest signal: they actually share words
        if (overlap >= 0.2){
            return true;
        }

        // quick short back-and-forth (greetings, reactions) - kept tight so we
        // don't pair two unrelated one-liners that merely happened to be close
        if (dtMs <= 10000 && pt.length <= 4 && rt.length <= 6){
            return true;
        }

        // question -> short answer
        if (dtMs <= 15000 && parentQuestion && rt.length <= 10){
            return true;
        }

        return false;
    }

    /**
     * Add a parentKey -> reply pair to the database
     *
     * @param {string} parent
     * @param {string} reply
     * @param {number} ts
     * @memberof MessageLearner
     */
    addPair(parent, reply, ts){
        this.db.run(
            "INSERT INTO pairs (parentKey, reply, ts) VALUES (?, ?, ?)",
            [parent, reply, ts],
        );
    }

    /**
     * Learn from a message
     *
     * @param {import("discord.js").Message & { replyToId?: string, authorId: string }} msg
     * @return {Promise<void>}
     * @memberof MessageLearner
     */
    async learn(msg){
        if (!msg || !msg.id) return;
        const ts = msg.createdTimestamp ?? Date.now();
        const clean = this.cleanText(msg.content);
        if (!clean) return;

        // Merge consecutive messages from same author within lookbackWindow
        if (msg.channelId){
            const last = this.lastMsgByChannel.get(msg.channelId);
            if (
                last && // @ts-ignore
                last.authorId === msg.authorId && !msg.replyToId &&
                ts - last.ts < this.lookbackWindow * 1000
            ){
                const merged = (last.content + " " + clean).trim();
                this.db.run("UPDATE messages SET content = ?, ts = ? WHERE id = ?", [
                    merged,
                    ts,
                    last.id,
                ]);
                this.lastMsgByChannel.set(msg.channelId, { ...last, content: merged, ts });
                return;
            }
        }

        // Insert into messages table
        this.db.run(
            `INSERT OR REPLACE INTO messages (id, channelId, content, authorId, replyToId, ts)
            VALUES (?, ?, ?, ?, ?, ?)`, // @ts-ignore
            [msg.id, msg.channelId, clean, msg.authorId, msg.replyToId ?? null, ts],
        );

        // Derive training pair
        let parentContent = null;

        if (msg.replyToId){
            // Explicit reply: always a valid pair.
            const row = this.db
                .query("SELECT content FROM messages WHERE id = ?")
                .get(msg.replyToId);
            // @ts-ignore
            if (row && row.content) parentContent = row.content;
        }
        else if (msg.channelId){
            // Implicit adjacency: only pair if it looks like a real exchange.
            const row = this.db
                .query(
                    `SELECT content, ts
                    FROM messages
                    WHERE channelId = ? AND authorId != ? AND id != ?
                    ORDER BY ts DESC LIMIT 1`,
                )
                .get(msg.channelId, msg.authorId, msg.id);
            // @ts-ignore
            if (row && row.content){
                // @ts-ignore
                const dt = Math.max(0, ts - (row.ts ?? ts));
                // @ts-ignore
                if (this.shouldPairAdjacent(row.content, clean, dt)){
                    // @ts-ignore
                    parentContent = row.content;
                }
            }
        }

        if (parentContent){
            this.addPair(parentContent, clean, ts);
        }

        // Update last message tracker
        this.lastMsgByChannel.set(msg.channelId, {
            id: msg.id,
            content: clean, // @ts-ignore
            authorId: msg.authorId,
            ts,
        });
    }
}
