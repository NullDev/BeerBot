import { BunDB } from "bun.db";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle user cleanup operations
 *
 * @class UserCleanupHandler
 */
class UserCleanupHandler {
    /**
     * Remove users from database that are no longer on the server
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof UserCleanupHandler
     */
    static async removeNonExistingUsers(client){
        Log.wait("[CRON] Checking for non-existing users...");

        let removedUsers = 0;
        let checkedUsers = 0;

        try {
            const guilds = client.guilds.cache;

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking guild: ${guild.name} (${guildId})`);

                const allData = await db.all();
                const userKeys = allData
                    .filter(item => item.id.startsWith("user-") && item.id.includes(".verified"))
                    .map(item => item.id);

                for (const userKey of userKeys){
                    const userId = userKey.split(".")[0].replace("user-", "");
                    checkedUsers++;

                    try {
                        const member = await guild.members.fetch(userId).catch(() => null);

                        if (!member){
                            await db.delete(`user-${userId}.verified`);
                            await db.delete(`user-${userId}.birthdate`);
                            await db.delete(`user-${userId}.birthday_ping`);

                            Log.done(`[CRON] Removed user ${userId} from guild ${guild.name} - user no longer exists`);
                            removedUsers++;
                        }
                    }
                    catch (error){
                        Log.error(`[CRON] Error checking user ${userId} in guild ${guild.name}:`, error);
                    }
                }
            }

            Log.done(`[CRON] Checked ${checkedUsers} users, removed ${removedUsers} non-existing users.`);
        }
        catch (error){
            Log.error("[CRON] Error in removeNonExistingUsers:", error);
        }
    }
}

export default UserCleanupHandler;
