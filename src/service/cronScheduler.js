import cron from "node-cron";
import Log from "../util/log.js";
import LogHandler from "../crons/removeOldLogs.js";
import UserCleanupHandler from "../crons/removeNonExistingUser.js";
import BirthdayChecker from "../crons/birthdayChecker.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Schedule all crons
 *
 * @param {import("../service/client.js").default} client
 */
const scheduleCrons = async function(client){
    // daily cron at 00:00
    cron.schedule("0 0 * * *", async() => {
        await BirthdayChecker.removeYesterdayBirthdayRoles(client);
        await BirthdayChecker.checkDailyBirthdays(client);
        await LogHandler.removeOldLogs();
    });

    // yearly cron on January 1st at 00:00
    cron.schedule("0 0 1 1 *", async() => {
        await BirthdayChecker.checkYearlyBirthdays(client);
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
