import os from "node:os";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import fs from "node:fs";
import Log from "../util/log";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export class DailyTrainer {
    constructor({ dbPath = "./data/brain.sqlite", outDir = "./data/ai" } = {}){
        this.db = new Database(dbPath);
        this.outDir = outDir;
    }

    /**
     * Get the correct Python executable path based on the OS.
     *
     * @return {string}
     * @memberof DailyTrainer
     */
    #getPyPath(){
        if (os.platform() === "win32"){
            return ".venv\\Scripts\\python.exe";
        }
        return "./.venv/bin/python";
    }

    /**
     * Exports the dataset from the database to a JSONL file.
     *
     * @memberof DailyTrainer
     */
    #exportDataset(){
        if (fs.existsSync(`${this.outDir}/dataset.jsonl`)){
            fs.unlinkSync(`${this.outDir}/dataset.jsonl`);
            Log.info("Old dataset.jsonl deleted");
        }
        const rows = this.db.query(`
            SELECT parentKey AS input, reply AS target
            FROM pairs
            WHERE length(input) > 0 AND length(target) > 0
        `).all();
        const jsonl = rows.map(r => JSON.stringify({ input: r.input, target: r.target })).join("\n");
        fs.writeFileSync(`${this.outDir}/dataset.jsonl`, jsonl);
        Log.info(`Wrote ${rows.length} pairs to dataset.jsonl`);
    }

    /**
     * Trains the model using the Python training script.
     *
     * @return {Promise<void>}
     * @memberof DailyTrainer
     */
    #trainPython(){
        return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
            const p = spawn(this.#getPyPath(), ["./src/ai/py/train.py"], { stdio: "inherit" });
            p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`train.py exit ${code}`))));
        }));
    }

    train(){
        this.#exportDataset();
        return this.#trainPython();
    }
}
