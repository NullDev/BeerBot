import os from "node:os";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import exportDb from "../util/exportDb";

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
    async #exportDataset(){
        await exportDb();
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

    async train(){
        await this.#exportDataset();
        return await this.#trainPython();
    }
}
