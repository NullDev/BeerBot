import cron from "node-cron";
import Log from "../util/log.js";
import LogHandler from "../crons/removeOldLogs.js";
import UserCleanupHandler from "../crons/removeNonExistingUser.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Schedule all crons
 *
 * @param {import("../service/client.js").default} client
 */
const scheduleCrons = async function(){
    // daily cron
    cron.schedule("0 0 * * *", async() => {
        await LogHandler.removeOldLogs();
    });

    // hourly cron
    cron.schedule("0 * * * *", async() => {
        await UserCleanupHandler.removeNonExistingUsers(client);
    });

    const cronCount = cron.getTasks().size;
    Log.done("Scheduled " + cronCount + " Crons.");

    // start jobs on init
    await LogHandler.removeOldLogs();
    await UserCleanupHandler.removeNonExistingUsers(client);
};

export default scheduleCrons;
