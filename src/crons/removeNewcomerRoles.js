import { BunDB } from "bun.db";
import { config } from "../../config/config.js";
import gLogger from "../service/gLogger.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle newcomer role cleanup operations
 *
 * @class NewcomerRoleCleanupHandler
 */
class NewcomerRoleCleanupHandler {
    /**
     * Remove newcomer roles from users who have had them for more than 1 week
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof NewcomerRoleCleanupHandler
     */
    static async removeNewcomerRoles(client){
        Log.wait("[CRON] Checking for users with newcomer roles older than 1 week...");

        let removedRoles = 0;
        let checkedUsers = 0;

        try {
            const guilds = client.guilds.cache;
            const currentTime = Date.now();
            const oneWeek = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking guild: ${guild.name} (${guildId})`);

                const newcomerRole = config.roles.newcommer;
                if (!newcomerRole){
                    Log.error(`[CRON] No newcomer role configured for guild ${guild.name}`);
                    continue;
                }

                const role = await guild.roles.fetch(newcomerRole);
                if (!role){
                    Log.error(`[CRON] Newcomer role not found in guild ${guild.name}`);
                    continue;
                }

                await guild.members.fetch();

                const membersWithNewcomerRole = guild.members.cache.filter(member =>
                    member.roles.cache.has(newcomerRole),
                );

                Log.info(`[CRON] Found ${membersWithNewcomerRole.size} users with newcomer role in guild ${guild.name}`);

                for (const [memberId, member] of membersWithNewcomerRole){
                    checkedUsers++;

                    try {
                        const newcomerRoleTime = await db.get(`user-${memberId}.newcomer_role_time`);
                        if (!newcomerRoleTime){
                            // If no newcomer role time stored, set it to now (first time we're checking this user)
                            await db.set(`user-${memberId}.newcomer_role_time`, currentTime);
                            Log.done(`[CRON] Set newcomer role time for user ${member.user.displayName} in guild ${guild.name}`);
                            continue;
                        }

                        const timeSinceNewcomerRole = currentTime - newcomerRoleTime;

                        if (timeSinceNewcomerRole >= oneWeek){
                            await member.roles.remove(newcomerRole)
                                .catch(e => Log.error(`[CRON] Error removing newcomer role from user ${member.user.displayName} in guild ${guild.name}:`, e));

                            await gLogger(
                                { user: member.user, guild: member.guild, client: member.client },
                                "🔷┃Newcomer Role Removal - Success",
                                `Benutzer ${member.user} hat die Newcomer-Rolle verloren, da sie länger als 1 Woche bestand.`,
                                "Blue",
                            );

                            await db.delete(`user-${memberId}.newcomer_role_time`);

                            Log.done(`[CRON] Removed newcomer role from user ${member.user.displayName} in guild ${guild.name} - role was active for more than 1 week`);
                            removedRoles++;
                        }
                    }
                    catch (error){
                        Log.error(`[CRON] Error checking user ${member.user.displayName} in guild ${guild.name}:`, error);
                    }
                }
            }

            Log.done(`[CRON] Checked ${checkedUsers} users with newcomer roles, removed ${removedRoles} roles for being active for more than 1 week.`);
        }
        catch (error){
            Log.error("[CRON] Error in removeNewcomerRoles:", error);
        }
    }
}

export default NewcomerRoleCleanupHandler;
