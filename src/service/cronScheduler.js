import cron from "node-cron";
import Log from "../util/log.js";
import LogHandler from "../crons/removeOldLogs.js";
import UserCleanupHandler from "../crons/removeNonExistingUser.js";
import BirthdayChecker from "../crons/birthdayChecker.js";
import UnverifiedUserCleanupHandler from "../crons/removeUnverifiedUsers.js";
import NewcomerRoleCleanupHandler from "../crons/removeNewcomerRoles.js";
// import sendRandomMsg from "../util/sendRandomMsg.js";
// import { DailyTrainer } from "../crons/aiTrainer.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

// const trainer = new DailyTrainer();

/**
 * Schedule all crons
 *
 * @param {import("../service/client.js").default} client
 */
const scheduleCrons = async function(client){
    // daily cron at 00:05
    cron.schedule("5 0 * * *", async() => {
        await BirthdayChecker.removeYesterdayBirthdayRoles(client);
        await BirthdayChecker.checkDailyBirthdays(client);
        await LogHandler.removeOldLogs();
        await NewcomerRoleCleanupHandler.removeNewcomerRoles(client);
    });

    // daily cron at 01:00
    /*
    cron.schedule("0 1 * * *", async() => {
        try {
            await trainer.train();
            Log.done("AI Training completed successfully.");
        }
        catch (e){
            Log.error("Error during AI training: " + e);
        }
    });
    */

    // yearly cron on January 1st at 00:00
    cron.schedule("0 0 1 1 *", async() => {
        await BirthdayChecker.checkYearlyBirthdays(client);
    });

    // hourly cron
    cron.schedule("0 * * * *", async() => {
        await UserCleanupHandler.removeNonExistingUsers(client);
    });

    // every 6 hours - check for unverified users to kick
    cron.schedule("0 */6 * * *", async() => {
        await UnverifiedUserCleanupHandler.kickUnverifiedUsers(client);
    });

    // every day at 13:37
    /*
    cron.schedule("37 13 * * *", async() => {
        await sendRandomMsg(client);
    });
    */

    const cronCount = cron.getTasks().size;
    Log.done("Scheduled " + cronCount + " Crons.");

    // start jobs on init
    await UnverifiedUserCleanupHandler.kickUnverifiedUsers(client);
    await LogHandler.removeOldLogs();
    await UserCleanupHandler.removeNonExistingUsers(client);
    await BirthdayChecker.checkStartupBirthdays(client);
    await BirthdayChecker.removeYesterdayBirthdayRoles(client);
};

export default scheduleCrons;
