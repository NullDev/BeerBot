import { BunDB } from "bun.db";
import { EmbedBuilder } from "discord.js";
import Log from "../util/log.js";
import { config } from "../../config/config.js";
import { getAgeRole, calculateAge, removeExistingAgeRoles } from "../service/dmVerification/utils.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle birthday checking operations
 *
 * @class BirthdayChecker
 */
class BirthdayChecker {
    /**
     * Check if today is someone's birthday (full date format)
     *
     * @static
     * @param {import("discord.js").Client} client
     * @memberof BirthdayChecker
     */
    static async checkDailyBirthdays(client, force = false){
        Log.wait("[CRON] Checking daily birthdays...");

        let birthdayUsers = 0;
        let roleUpdates = 0;
        let birthdayMessages = 0;

        try {
            const today = new Date().toDateString();
            const todayKey = `birthday_check_${today}`;

            const alreadyProcessed = await db.get(todayKey);
            if (alreadyProcessed && !force){
                Log.wait("[CRON] Daily birthday check already completed for today, skipping...");
                return;
            }

            if (force){
                Log.wait("[CRON] Force mode: clearing processed state and running birthday check...");
                await db.delete(todayKey);
            }

            const guilds = client.guilds.cache;

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking birthdays in guild: ${guild.name} (${guildId})`);

                const allData = await db.all();
                const userEntries = allData.filter(item => item.id.startsWith("user-"));
                const verifiedUsers = [];

                for (const userEntry of userEntries){
                    const userData = userEntry.value;
                    if (userData && userData.verified){
                        const userId = userEntry.id.replace("user-", "");
                        verifiedUsers.push({ userId, userData });
                    }
                }

                Log.debug(`[CRON] Found ${verifiedUsers.length} verified users in guild ${guild.name}`);

                const guildBirthdayUsers = [];
                const birthdayUserData = [];

                for (const { userId, userData } of verifiedUsers){
                    const {birthdate} = userData;
                    const birthdayPing = userData.birthday_ping;

                    Log.debug(`[CRON] Processing user ${userId}: birthdate=${birthdate}, birthdayPing=${birthdayPing}`);

                    if (!birthdate || !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate)){
                        Log.debug(`[CRON] Skipping user ${userId}: invalid date format`);
                        continue;
                    }

                    const todayDate = new Date();
                    const birthDate = new Date(birthdate.split(".").reverse().join("-"));

                    Log.debug(`[CRON] Checking ${userId}: birthdate=${birthdate}, today=${todayDate.toDateString()}, birthDate=${birthDate.toDateString()}, isToday=${todayDate.getDate() === birthDate.getDate() && todayDate.getMonth() === birthDate.getMonth()}`);

                    if (todayDate.getDate() === birthDate.getDate() && todayDate.getMonth() === birthDate.getMonth()){
                        birthdayUsers++;
                        birthdayUserData.push({ userId, userData });
                    }
                }

                for (const { userId, userData } of birthdayUserData){
                    try {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (!member){
                            Log.debug(`[CRON] User ${userId} not found in guild ${guild.name}`);
                            continue;
                        }
                        Log.debug(`[CRON] Found member ${member.user.displayName} (${userId}) in guild ${guild.name}`);

                        try {
                            const currentAge = calculateAge(userData.birthdate);
                            if (currentAge){
                                const newAgeRoleId = getAgeRole(currentAge);

                                const hasCurrentAgeRole = Object.values(config.roles.ages).some(roleId =>
                                    roleId && member.roles.cache.has(roleId),
                                );

                                if (newAgeRoleId && !hasCurrentAgeRole){
                                    await removeExistingAgeRoles(member);
                                    await member.roles.add(newAgeRoleId);
                                    roleUpdates++;
                                    Log.done(`[CRON] Updated age role for ${member.user.displayName} to age ${currentAge}`);
                                }
                            }
                        }
                        catch (error){
                            Log.error(`[CRON] Error updating age role for user ${userId} in guild ${guild.name}:`, error);
                        }

                        if (userData.birthday_ping){
                            guildBirthdayUsers.push(member);
                        }

                        if (userData.birthday_ping && config.roles.birthday){
                            try {
                                if (!member.roles.cache.has(config.roles.birthday)){
                                    await member.roles.add(config.roles.birthday);
                                }
                            }
                            catch (error){
                                Log.error(`[CRON] Error adding birthday role for user ${userId} in guild ${guild.name}:`, error);
                            }
                        }
                    }
                    catch (error){
                        Log.error(`[CRON] Error processing birthday for user ${userId} in guild ${guild.name}:`, error);
                    }
                }

                if (guildBirthdayUsers.length > 0 && config.channels.general && config.roles.birthday){
                    const generalChannel = await guild.channels.fetch(config.channels.general).catch(() => null);
                    if (generalChannel){
                        const birthdayUsernames = guildBirthdayUsers.map(member => member.user).join(", ");

                        const birthdayEmbed = new EmbedBuilder()
                            .setTitle("🎂┃Geburtstag!")
                            .setDescription(`Ois guade zum Geburtstag <@&${config.roles.birthday}>! 🎉\n\n**Geburtstagskinder:** ${birthdayUsernames}`)
                            .setColor(13111086)
                            .setTimestamp();

                        await /** @type {import("discord.js").TextChannel} */ (generalChannel).send({
                            content: `<@&${config.roles.birthday}>`,
                            embeds: [birthdayEmbed],
                        });
                        birthdayMessages++;
                        Log.done(`[CRON] Sent birthday message for ${guildBirthdayUsers.length} users in guild ${guild.name}`);
                    }
                }
            }

            await db.set(todayKey, true);
            Log.done(`[CRON] Daily birthday check complete. Found ${birthdayUsers} birthdays, updated ${roleUpdates} roles, sent ${birthdayMessages} messages.`);
        }
        catch (error){
            Log.error("[CRON] Error in checkDailyBirthdays:", error);
        }
    }

    /**
     * Remove birthday roles from yesterday's birthdays
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof BirthdayChecker
     */
    static async removeYesterdayBirthdayRoles(client){
        Log.wait("[CRON] Removing yesterday's birthday roles...");

        let removedRoles = 0;

        try {
            const guilds = client.guilds.cache;

            for (const [, guild] of guilds){
                if (!config.roles.birthday) continue;

                const membersWithBirthdayRole = guild.members.cache.filter(member =>
                    member.roles.cache.has(config.roles.birthday),
                );

                for (const [memberId, member] of membersWithBirthdayRole){
                    const birthdate = await db.get(`user-${memberId}.birthdate`);
                    if (!birthdate) continue;

                    if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate)) continue;

                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const birthDate = new Date(birthdate.split(".").reverse().join("-"));

                    if (yesterday.getDate() === birthDate.getDate() && yesterday.getMonth() === birthDate.getMonth()){
                        await member.roles.remove(config.roles.birthday).catch(() => null);
                        removedRoles++;
                        Log.done(`[CRON] Removed birthday role from ${member.user.displayName}`);
                    }
                }
            }

            Log.done(`[CRON] Removed ${removedRoles} birthday roles from yesterday's birthdays.`);
        }
        catch (error){
            Log.error("[CRON] Error in removeYesterdayBirthdayRoles:", error);
        }
    }

    /**
     * Check yearly birthdays (year-only format) on January 1st
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof BirthdayChecker
     */
    static async checkYearlyBirthdays(client){
        Log.wait("[CRON] Checking yearly birthdays...");

        let updatedUsers = 0;

        try {
            const guilds = client.guilds.cache;

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking yearly birthdays in guild: ${guild.name} (${guildId})`);

                const allData = await db.all();
                const userKeys = allData
                    .filter(item => item.id.startsWith("user-") && item.id.includes(".birthdate"))
                    .map(item => item.id);

                for (const userKey of userKeys){
                    const userId = userKey.split(".")[0].replace("user-", "");
                    const birthdate = await db.get(`user-${userId}.birthdate`);

                    if (!/^\d{4}$/.test(birthdate)){
                        continue;
                    }

                    try {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (!member) continue;

                        const currentAge = calculateAge(birthdate);
                        if (!currentAge) continue;
                        const newAgeRoleId = getAgeRole(currentAge);

                        const hasCurrentAgeRole = Object.values(config.roles.ages).some(roleId =>
                            roleId && member.roles.cache.has(roleId),
                        );

                        if (newAgeRoleId && !hasCurrentAgeRole){
                            await removeExistingAgeRoles(member);
                            await member.roles.add(newAgeRoleId);
                            updatedUsers++;
                            Log.done(`[CRON] Updated age role for ${member.user.displayName} to age ${currentAge} (yearly check)`);
                        }
                    }
                    catch (error){
                        Log.error(`[CRON] Error processing yearly birthday for user ${userId} in guild ${guild.name}:`, error);
                    }
                }
            }

            Log.done(`[CRON] Yearly birthday check complete. Updated ${updatedUsers} age roles.`);
        }
        catch (error){
            Log.error("[CRON] Error in checkYearlyBirthdays:", error);
        }
    }

    /**
     * Check if we need to run birthday check on startup (in case bot crashed)
     *
     * @static
     * @param {import("../service/client.js").default} client
     * @memberof BirthdayChecker
     */
    static async checkStartupBirthdays(client){
        Log.wait("[CRON] Checking if birthday check is needed on startup...");

        try {
            const today = new Date().toDateString();
            const todayKey = `birthday_check_${today}`;

            const alreadyProcessed = await db.get(todayKey);
            if (!alreadyProcessed){
                Log.wait("[CRON] Birthday check not completed for today, running now...");
                await this.checkDailyBirthdays(client);
            }
            else {
                Log.done("[CRON] Birthday check already completed for today, skipping startup check.");
            }
        }
        catch (error){
            Log.error("[CRON] Error in checkStartupBirthdays:", error);
        }
    }
}

export default BirthdayChecker;
