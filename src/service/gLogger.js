import { BunDB } from "bun.db";
import { EmbedBuilder } from "discord.js";
import Log from "../util/log";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Log to a guild
 *
 * @param {import("discord.js").Interaction | { user: import("discord.js").User, guild: import("discord.js").Guild, client: import("discord.js").Client }} interaction
 * @param {string} title
 * @param {string} description
 * @param {import("discord.js").ColorResolvable | null} [color="Green"]
 */
const gLogger = async function(interaction, title, description, color = "Green"){
    const guildId = "guildId" in interaction ? interaction.guildId : interaction.guild?.id;
    if (!guildId){
        Log.warn("gLogger: No guildId found");
        return;
    }

    const logChannelId = await db.get(`guild-${guildId}.log_channel`);
    if (!logChannelId){
        Log.warn(`gLogger: No log channel set for guild ${guildId}`);
        return;
    }

    const { guild, client } = interaction;
    if (!guild || !client){
        Log.warn(`gLogger: Missing guild or client. Guild: ${!!guild}, Client: ${!!client}`);
        return;
    }

    if (!guild){
        Log.warn(`gLogger: Could not fetch guild ${guildId}`);
        Log.warn(`gLogger: Available guilds: ${client?.guilds.cache.map(g => g.id).join(", ")}`);
        return;
    }

    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel){
        Log.warn(`gLogger: Could not fetch log channel ${logChannelId} in guild ${guildId}`);
        return;
    }

    const logEmbed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp()
        .setColor(color);

    await /** @type {import("discord.js").GuildTextBasedChannel} */ (logChannel).send({
        embeds: [logEmbed],
    }).catch((error) => {
        Log.error(`gLogger: Failed to send log message: ${error.message}`);
    });
};

export default gLogger;
