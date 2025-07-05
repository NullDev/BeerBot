import { BunDB } from "bun.db";
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    InteractionContextType,
} from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Setz den Channel wo de Verifikationslogs gsendet werdn suin.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption((option) =>
            option.setName("channel")
                .setDescription("Da Channel zum hinsendn")
                .setRequired(true)),

    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        const channel = interaction.options.get("channel");
        if (!channel){
            return await interaction.reply({
                content: "A Channel muas gsetzt werdn.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        let val = String(channel.value)?.match(/^<#(\d+)>$/)?.[1];

        if (!val) val = (await interaction.guild?.channels.fetch().catch(() => null))?.find(ch => ch?.name === channel.value && ch?.type === ChannelType.GuildText)?.id;
        if (!val){
            return await interaction.reply({
                content: "I konn den Channel ned findn.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        await db.set(`guild-${interaction.guildId}.log_channel`, val);

        return await interaction.reply({
            content: "Log Channel wurd au <#" + val + "> gsetzt.",
            flags: [MessageFlags.Ephemeral],
        });
    },
};
