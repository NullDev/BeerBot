import { Database } from "bun:sqlite";
import fs from "node:fs";
import Log from "./log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export default async function exportDb(){
    const db = new Database("./data/brain.sqlite");

    // --- Utils ---

    const stripCode = (/** @type {string} */ s) => s
        .replace(/```[\s\S]*?```/g, " ") // code blocks
        .replace(/`[^`]*`/g, " ");       // inline code

    const stripUrls = (/** @type {string} */ s) => s
        .replace(/\bhttps?:\/\/\S+/gi, " ")
        .replace(/\b(?:www\.)\S+/gi, " ");

    const stripMentions = (/** @type {string} */ s) => s
        .replace(/<@!?&?\d+>/g, " ") // Discord mentions/roles
        .replace(/@\w+/g, " ")       // plain @name
        .replace(/<#[0-9]+>/g, " "); // channel refs

    const normalize = (/** @type {string} */ s) => s
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

    const shouldKeep = (/** @type {string} */ s) =>
        s.length >= 2 &&
    !/^[:;][\)\(DPp]/.test(s) && // pure emoticon lines
    !/^\W+$/.test(s);

    // --- clean up old files ---

    if (fs.existsSync("./data/ai/dataset.jsonl")){
        fs.unlinkSync("./data/ai/dataset.jsonl");
        Log.info("Old dataset.jsonl deleted");
    }

    if (fs.existsSync("./data/ai/raw_messages.txt")){
        fs.unlinkSync("./data/ai/raw_messages.txt");
        Log.info("Old raw_messages.txt deleted");
    }

    // --- msg pairs with context ---

    // Get all pairs with timestamps
    const pairs = db.query(`
    SELECT parentKey AS input, reply AS target, ts
    FROM pairs
    WHERE length(parentKey) > 0 AND length(reply) > 0
    ORDER BY ts
`).all();

    const out = pairs.map(p => {
        let {input} = p;

        const prevMsg = db.query(`
        SELECT content
        FROM messages
        WHERE ts < ? AND ts > ? - 60000
            AND content IS NOT NULL
            AND length(trim(content)) > 0
            AND content != ?
        ORDER BY ts DESC
        LIMIT 1
    `).get(p.ts, p.ts, p.input);

        if (prevMsg && prevMsg.content){
            let ctx = prevMsg.content;
            ctx = stripCode(stripUrls(stripMentions(ctx)));
            ctx = normalize(ctx);
            if (shouldKeep(ctx)){
                input = `[PREV: ${ctx}] ${p.input}`;
            }
        }

        return JSON.stringify({ input, target: p.target });
    }).join("\n");

    fs.writeFileSync("./data/ai/dataset.jsonl", out);
    Log.done(`Wrote ${pairs.length} pairs (with context where available)`);

    // --- raw msgs ---

    const rows2 = db.query(`
    SELECT content FROM messages
    WHERE content IS NOT NULL AND length(trim(content)) > 0
    ORDER BY ts
`).all();

    const lines = [];
    for (const r of rows2){
        let t = r.content;
        t = stripCode(stripUrls(stripMentions(t)));
        t = normalize(t);
        if (shouldKeep(t)) lines.push(t);
    }

    const dedup = Array.from(new Set(lines));

    fs.writeFileSync("./data/ai/raw_messages.txt", dedup.join("\n"), "utf8");
    Log.done(`Wrote ${dedup.length} lines to raw_messages.txt`);

    // --- remove unused table ---

    db.run("DROP TABLE IF EXISTS markov");

    // --- cleanup ---

    db.close();
}
