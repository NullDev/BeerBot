import { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Raid.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const responseContent = "> <@371724846205239326> successfully executed server raid ✅";

        if (interaction.deferred){
            return await interaction.editReply({
                content: responseContent,
            });
        }
        return await interaction.reply({
            content: responseContent,
        });
    },
};
