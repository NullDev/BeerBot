import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new Database("./data/brain.sqlite");

const rows = db.query(`
    SELECT parentKey AS input, reply AS target
    FROM pairs
    WHERE length(input) > 0 AND length(target) > 0
`).all();

const out = rows.map(r => JSON.stringify({ input: r.input, target: r.target })).join("\n");

writeFileSync("./data/ai/dataset.jsonl", out);
console.log("Wrote", rows.length, "pairs");

db.close();
