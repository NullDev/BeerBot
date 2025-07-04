import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

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
            Log.done(`Added unverified role to new member ${member.user.displayName} in guild ${member.guild.name}`);
        }
    }
    catch (error){
        Log.error(`Error adding unverified role to new member ${member.user.displayName}:`, error);
    }
};

export default guildMemberAddHandler;
