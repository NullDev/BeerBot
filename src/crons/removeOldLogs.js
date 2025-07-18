import path from "node:path";
import fs from "node:fs/promises";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle log cleanups and other operations
 *
 * @class LogHandler
 */
class LogHandler {
    /**
     * Get date from filename
     *
     * @static
     * @param {string} filename
     * @return {Number | null}
     * @memberof LogHandler
     */
    static #getDateFromFilename(filename){
        // Format: PROJECTNAME-DD-MM-YYYY-output.log and PROJECTNAME-DD-MM-YYYY-errors.log
        const regex = /(\d{2})-(\d{2})-(\d{4})/;
        const match = filename.match(regex);

        if (match){
            const day = Number(match[1]);
            const month = Number(match[2]);
            const year = Number(match[3]);

            const dateX = new Date(year, month - 1, day);
            const date = new Date(dateX.getTime() + Math.abs(dateX.getTimezoneOffset() * 60000));

            return date.getTime();
        }
        return null;
    }

    /**
     * Remove logs that are older than 31 days
     *
     * @static
     * @memberof LogHandler
     */
    static async removeOldLogs(){
        Log.wait("[CRON] Deleting old logs...");

        let deletedLogs = 0;

        const logDir = path.resolve("./logs");
        const eLogDir = path.resolve("./logs/errors");

        const logs = (await fs.readdir(logDir)).filter(f => f.endsWith(".log")).map(f => path.resolve(logDir, f));
        const eLogs = (await fs.readdir(eLogDir)).filter(f => f.endsWith(".log")).map(f => path.resolve(eLogDir, f));

        const allLogs = [...logs, ...eLogs];

        const thirtyOneDaysAgoX = new Date();
        thirtyOneDaysAgoX.setDate(thirtyOneDaysAgoX.getDate() - 31);

        const thirtyOneDaysAgo = (new Date(thirtyOneDaysAgoX.getTime() + Math.abs(thirtyOneDaysAgoX.getTimezoneOffset() * 60000))).getTime();

        await Promise.all(allLogs.map(async f => {
            const fileDateFromName = this.#getDateFromFilename(f);
            if (!fileDateFromName || fileDateFromName < thirtyOneDaysAgo){
                await fs.unlink(f).catch(e => Log.error(`[CRON] Could not remove old log ${f}`, e));
                Log.done(`[CRON] Removed old log ${f}.`);
                ++deletedLogs;
            }
        }));

        Log.done(`[CRON] Removed ${deletedLogs} old log${deletedLogs === 1 ? "" : "s"}.`);
    }
}

export default LogHandler;
