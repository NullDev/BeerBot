import { BunDB } from "bun.db";
import Log from "../util/log.js";
import gLogger from "../service/gLogger.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle country role transition for verified users
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<string|null>}
 */
const handleCountryRoleTransition = async function(member){
    const isVerified = await db.get(`user-${member.id}.verified`);
    if (!isVerified) return null;

    if (!config.roles.verified || !member.roles.cache.has(config.roles.verified)) return null;

    for (const [countryCode, roleId] of Object.entries(config.roles.country_verified)){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId);
            Log.debug(`Removed verified country role ${countryCode} from user ${member.user.displayName}`);
        }
    }

    for (const [countryCode, roleId] of Object.entries(config.roles.country_unverified)){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId);

            const verifiedRoleId = config.roles.country_verified[countryCode];
            if (verifiedRoleId){
                await member.roles.add(verifiedRoleId);
            }

            return countryCode;
        }
    }
    return null;
};

/**
 * Handle guild member update event
 *
 * @param {import("discord.js").GuildMember | import("discord.js").PartialGuildMember} oldMember
 * @param {import("discord.js").GuildMember} newMember
 * @return {Promise<void>}
 */
const handleGuildMemberUpdate = async function(oldMember, newMember){
    try {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        for (const [countryCode, roleId] of Object.entries(config.roles.country_unverified)){
            if (roleId && !oldRoles.has(roleId) && newRoles.has(roleId)){
                const transitionCountry = await handleCountryRoleTransition(newMember);

                if (transitionCountry){
                    Log.done(`User ${newMember.user.displayName} had country role automatically updated from ${countryCode}_unverified to ${countryCode}_verified`);

                    await gLogger(
                        { user: newMember.user, guild: newMember.guild, client: newMember.client },
                        "🔷┃Country Role Update",
                        `Benutzer ${newMember.user} hatte automatisch die Länderrolle von ${countryCode.toUpperCase()}_unverified zu ${countryCode.toUpperCase()}_verified geändert.`,
                    );
                }
                break;
            }
        }
    }
    catch (error){
        Log.error(`Error handling guild member update for user ${newMember.user.displayName}:`, error);
    }
};

export default handleGuildMemberUpdate;
