import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

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

// --- msg pairs ---

const rows = db.query(`
    SELECT parentKey AS input, reply AS target
    FROM pairs
    WHERE length(input) > 0 AND length(target) > 0
`).all();

const out = rows.map(r => JSON.stringify({ input: r.input, target: r.target })).join("\n");

writeFileSync("./data/ai/dataset.jsonl", out);
console.log("Wrote", rows.length, "pairs");

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

writeFileSync("./data/ai/raw_messages.txt", dedup.join("\n"), "utf8");
console.log(`Wrote ${dedup.length} lines to raw_messages.txt`);

// --- remove unused table ---

db.run("DROP TABLE IF EXISTS markov");

// --- cleanup ---

db.close();
