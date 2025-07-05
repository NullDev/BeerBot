import { BunDB } from "bun.db";
import Log from "../util/log.js";
import gLogger from "../service/gLogger.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle guildMemberRemove event
 *
 * @param {import("discord.js").GuildMember | import("discord.js").PartialGuildMember} member
 * @return {Promise<void>}
 */
const guildMemberRemoveHandler = async function(member){
    if (member.partial) return;

    try {
        const userId = member.user.id;

        await db.delete(`user-${userId}.verified`);
        await db.delete(`user-${userId}.birthdate`);
        await db.delete(`user-${userId}.birthday_ping`);
        await db.delete(`user-${userId}.gender`);
        await db.delete(`user-${userId}.verification_state`);
        await db.delete(`user-${userId}.verification_guild`);
        await db.delete(`user-${userId}.verification_timeout`);
        await db.delete(`user-${userId}.temp_birthdate`);
        await db.delete(`user-${userId}.temp_is_full_date`);

        Log.done(`[EVENT] User ${member.user.displayName} left guild ${member.guild.name} - removed verification data`);

        await gLogger(
            { user: member.user, guild: member.guild, client: member.client },
            "🔷┃User Left - Data Cleanup",
            `Benutzer ${member.user} hat den Server verlassen.\nAlle Verifikationsdaten wurden automatisch entfernt.`,
        );
    }
    catch (error){
        Log.error(`[EVENT] Error during user cleanup for ${member.user.displayName}:`, error);
    }
};

export default guildMemberRemoveHandler;
