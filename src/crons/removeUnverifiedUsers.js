import { BunDB } from "bun.db";
import { config } from "../../config/config.js";
import gLogger from "../service/gLogger.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle unverified user cleanup operations
 *
 * @class UnverifiedUserCleanupHandler
 */
class UnverifiedUserCleanupHandler {
    /**
     * Kick users who haven't verified within 48 hours
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof UnverifiedUserCleanupHandler
     */
    static async kickUnverifiedUsers(client){
        Log.wait("[CRON] Checking for unverified users older than 48 hours...");

        let kickedUsers = 0;
        let checkedUsers = 0;

        try {
            const guilds = client.guilds.cache;
            const currentTime = Date.now();
            const fortyEightHours = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking guild: ${guild.name} (${guildId})`);

                const unverifiedRole = config.roles.unverified;
                if (!unverifiedRole){
                    Log.error(`[CRON] No unverified role configured for guild ${guild.name}`);
                    continue;
                }

                const role = await guild.roles.fetch(unverifiedRole);
                if (!role){
                    Log.error(`[CRON] Unverified role not found in guild ${guild.name}`);
                    continue;
                }

                await guild.members.fetch();

                const membersWithUnverifiedRole = guild.members.cache.filter(member =>
                    member.roles.cache.has(unverifiedRole),
                );

                Log.info(`[CRON] Found ${membersWithUnverifiedRole.size} users with unverified role in guild ${guild.name}`);

                for (const [memberId, member] of membersWithUnverifiedRole){
                    checkedUsers++;

                    try {
                        const joinTime = await db.get(`user-${memberId}.unverified_join_time`);
                        if (!joinTime){
                            // If no join time stored, set it to now (first time we're checking this user)
                            await db.set(`user-${memberId}.unverified_join_time`, currentTime);
                            Log.done(`[CRON] Set join time for user ${member.user.displayName} in guild ${guild.name}`);
                            continue;
                        }

                        const timeSinceJoin = currentTime - joinTime;

                        if (timeSinceJoin >= fortyEightHours){
                            await member.kick("Nicht verifiziert innerhalb von 48 Stunden")
                                .catch(e => Log.error(`[CRON] Error kicking user ${member.user.displayName} in guild ${guild.name}:`, e));

                            await gLogger(
                                { user: member.user, guild: member.guild, client: member.client },
                                "🔷┃User kick - Sucess",
                                `Benutzer ${member.user} wurde aus dem Server ${member.guild} gekickt, da er nicht innerhalb von 48 Stunden verifiziert hat.`,
                                "Red",
                            );

                            await db.delete(`user-${memberId}.unverified_join_time`);
                            await db.delete(`user-${memberId}.verification_state`);
                            await db.delete(`user-${memberId}.verification_guild`);
                            await db.delete(`user-${memberId}.verification_timeout`);
                            await db.delete(`user-${memberId}.temp_birthdate`);
                            await db.delete(`user-${memberId}.temp_is_full_date`);
                            await db.delete(`user-${memberId}.temp_age`);
                            await db.delete(`user-${memberId}.temp_birthday_ping`);
                            await db.delete(`user-${memberId}.temp_gender`);

                            Log.done(`[CRON] Kicked user ${member.user.displayName} from guild ${guild.name} - not verified within 48 hours`);
                            kickedUsers++;
                        }
                    }
                    catch (error){
                        Log.error(`[CRON] Error checking user ${member.user.displayName} in guild ${guild.name}:`, error);
                    }
                }
            }

            Log.done(`[CRON] Checked ${checkedUsers} unverified users, kicked ${kickedUsers} users for not verifying within 48 hours.`);
        }
        catch (error){
            Log.error("[CRON] Error in kickUnverifiedUsers:", error);
        }
    }
}

export default UnverifiedUserCleanupHandler;
