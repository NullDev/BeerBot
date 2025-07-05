import { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } from "discord.js";
import welcomeHandler from "../../service/welcomeHandler.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Debug command to test the welcome handler with any user.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName("user")
                .setDescription("The user to test the welcome handler with")
                .setRequired(true)),

    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            const targetUser = interaction.options.getUser("user");
            if (!targetUser){
                return await interaction.editReply({
                    content: "❌ User not found.",
                });
            }

            const targetMember = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember){
                return await interaction.editReply({
                    content: "❌ User is not a member of this server.",
                });
            }

            await welcomeHandler(targetMember);

            return await interaction.editReply({
                content: `✅ Welcome message sent for ${targetUser}!`,
            });
        }
        catch (error){
            console.error("Error in debug-welcome command:", error);

            return await interaction.editReply({
                content: `❌ Error testing welcome handler: ${error.message}`,
            });
        }
    },
};
