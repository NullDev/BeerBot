import os from "node:os";
import { spawn } from "node:child_process";
import Log from "../util/log";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/*
 * Manages a Python AI inference server process.
 *
 * @export
 * @class PythonAIWorker
 */
export class PythonAIWorker {
    // @ts-ignore
    #proc;
    #ready;

    /**
     * Creates an instance of PythonAIWorker.
     *
     * @param {string} [scriptPath="./src/ai/py/inference.py"]
     * @memberof PythonAIWorker
     */
    constructor(scriptPath = "./src/ai/py/inference.py"){
        this.scriptPath = scriptPath;
        this.#ready = false;
        this.#start();
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
     * Start the Python inference server process.
     *
     * @memberof PythonAIWorker
     */
    #start(){
        this.#proc = spawn(this.#getPyPath(), [this.scriptPath], {
            stdio: ["pipe", "pipe", "inherit"], // stdin, stdout, stderr
        });

        this.#proc.on("spawn", () => {
            Log.done("[AIWorker] Python AI Worker started with PID " + this.#proc.pid);
        });

        this.#proc.stdout.setEncoding("utf8");

        this.#proc.on("error", (/** @type {Error} */ err) => {
            Log.error("[AIWorker] Failed to start Python process:", err);
        });

        this.#proc.on("exit", (/** @type {any} */ code, /** @type {any} */ signal) => {
            Log.warn(`[AIWorker] Python process exited with code=${code} signal=${signal}`);
            this.#ready = false;
            // setTimeout(() => this.#start(), 2000);
        });

        this.#ready = true;
    }

    /**
     * Send text to the Python process for inference and get the response.
     *
     * @param {string} text
     * @return {Promise<string>}
     * @memberof PythonAIWorker
     */
    infer(text){
        if (!this.#ready) return Promise.reject(new Error("Python worker not running"));

        return new Promise((resolve, reject) => {
            const req = JSON.stringify({ text }) + "\n";
            this.#proc.stdin.write(req);

            const onData = (/** @type {string} */ data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.ok){
                        Log.debug("[AIWorker] Inference request: '" + text + "'");
                        Log.debug("[AIWorker] Inference response: '" + msg.result + "'");
                        Log.debug("[AIWorker] Inference method: '" + msg.method + "'");
                        resolve(msg.result);
                    }
                    else reject(new Error(msg.error));
                }
                catch (e){
                    reject(e);
                }
                finally {
                    this.#proc.stdout.off("data", onData);
                }
            };

            this.#proc.stdout.on("data", onData);
        });
    }

    stop(){
        if (this.#proc){
            this.#proc.kill("SIGTERM");
            this.#proc = null;
            this.#ready = false;
        }
    }
}
