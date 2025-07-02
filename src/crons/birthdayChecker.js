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
     * @param {import("../service/client.js").default} client
     * @memberof BirthdayChecker
     */
    static async checkDailyBirthdays(client){
        Log.wait("[CRON] Checking daily birthdays...");

        let birthdayUsers = 0;
        let roleUpdates = 0;
        let birthdayMessages = 0;

        try {
            const guilds = client.guilds.cache;

            for (const [guildId, guild] of guilds){
                Log.wait(`[CRON] Checking birthdays in guild: ${guild.name} (${guildId})`);

                const allData = await db.all();
                const userKeys = allData
                    .filter(item => item.id.startsWith("user-") && item.id.includes(".birthdate"))
                    .map(item => item.id);

                const guildBirthdayUsers = [];

                for (const userKey of userKeys){
                    const userId = userKey.split(".")[0].replace("user-", "");
                    const birthdate = await db.get(`user-${userId}.birthdate`);
                    const birthdayPing = await db.get(`user-${userId}.birthday_ping`);

                    if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate)){
                        continue;
                    }

                    const today = new Date();
                    const birthDate = new Date(birthdate.split(".").reverse().join("-"));

                    if (today.getDate() === birthDate.getDate() && today.getMonth() === birthDate.getMonth()){
                        birthdayUsers++;

                        try {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (!member) continue;

                            const currentAge = calculateAge(birthdate);
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

                            if (birthdayPing && config.roles.birthday){
                                if (!member.roles.cache.has(config.roles.birthday)){
                                    await member.roles.add(config.roles.birthday);
                                }
                                guildBirthdayUsers.push(member);
                            }
                        }
                        catch (error){
                            Log.error(`[CRON] Error processing birthday for user ${userId} in guild ${guild.name}:`, error);
                        }
                    }
                }

                if (guildBirthdayUsers.length > 0 && config.channels.general && config.roles.birthday){
                    const generalChannel = await guild.channels.fetch(config.channels.general).catch(() => null);
                    if (generalChannel){
                        const birthdayUsernames = guildBirthdayUsers.map(member => member.user.displayName).join(", ");

                        const birthdayEmbed = new EmbedBuilder()
                            .setTitle("🎂┃Geburtstag!")
                            .setDescription(`Ois guade zum Geburtstag <@&${config.roles.birthday}>! 🎉\n\n**Geburtstagskinder:** ${birthdayUsernames}`)
                            .setColor(13111086)
                            .setTimestamp();

                        await generalChannel.send({
                            content: `<@&${config.roles.birthday}>`,
                            embeds: [birthdayEmbed],
                        });
                        birthdayMessages++;
                        Log.done(`[CRON] Sent birthday message for ${guildBirthdayUsers.length} users in guild ${guild.name}`);
                    }
                }
            }

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
}

export default BirthdayChecker;
