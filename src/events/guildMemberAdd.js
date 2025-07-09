import { BunDB } from "bun.db";
import { config } from "../../config/config.js";
import Log from "../util/log.js";
import gLogger from "../service/gLogger.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Handle guildMemberAdd event
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<void>}
 */
const guildMemberAddHandler = async function(member){
    try {
        if (config.roles.unverified && !member.roles.cache.has(config.roles.unverified)){
            await member.roles.add(config.roles.unverified);
            await db.set(`user-${member.user.id}.unverified_join_time`, Date.now());

            Log.done(`Added unverified role to new member ${member.user.displayName} in guild ${member.guild.name}`);

            await gLogger(
                { user: member.user, guild: member.guild, client: member.client },
                "🔷┃User Added - Unverified Role",
                `Benutzer ${member.user} wurde dem Server hinzugefügt und hat die Rolle "Unverified" erhalten.`,
                "Blue",
            );
        }
    }
    catch (error){
        Log.error(`Error adding unverified role to new member ${member.user.displayName}:`, error);
    }
};

export default guildMemberAddHandler;
