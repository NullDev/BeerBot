import { BunDB } from "bun.db";
import { EmbedBuilder } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Log to a guild
 *
 * @param {import("discord.js").Interaction | import("discord.js").CommandInteraction | { user: import("discord.js").User, guildId: string }} interaction
 * @param {string} title
 * @param {string} description
 * @param {import("discord.js").ColorResolvable | null} [color="Green"]
 */
const gLogger = async function(interaction, title, description, color = "Green"){
    const guildId = interaction.guildId || interaction.guild?.id;
    if (!guildId){
        console.log("gLogger: No guildId found");
        return;
    }

    const logChannelId = await db.get(`guild-${guildId}.log_channel`);
    if (!logChannelId){
        console.log(`gLogger: No log channel set for guild ${guildId}`);
        return;
    }

    const { guild } = interaction;
    const { client } = interaction;

    // If we don't have a guild or client, we can't proceed
    if (!guild || !client){
        console.log(`gLogger: Missing guild or client. Guild: ${!!guild}, Client: ${!!client}`);
        return;
    }

    if (!guild){
        console.log(`gLogger: Could not fetch guild ${guildId}`);
        console.log(`gLogger: Available guilds: ${client?.guilds.cache.map(g => g.id).join(", ")}`);
        return;
    }

    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel){
        console.log(`gLogger: Could not fetch log channel ${logChannelId} in guild ${guildId}`);
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
        console.log(`gLogger: Failed to send log message: ${error.message}`);
    });
};

export default gLogger;
