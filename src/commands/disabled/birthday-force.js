import { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } from "discord.js";
import Log from "../../util/log.js";
import BirthdayChecker from "../../crons/birthdayChecker.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Force birthday check to run immediately (clears processed state).")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        try {
            await interaction.reply({
                content: "🔄 Forcing birthday check to run...",
                flags: [MessageFlags.Ephemeral],
            });

            await BirthdayChecker.checkDailyBirthdays(interaction.client, true);

            await interaction.editReply({
                content: "✅ Birthday check completed! Check the logs for details.",
            });
        }
        catch (error){
            Log.error("Error in birthday-force command:", error);
            await interaction.editReply({
                content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
            });
        }
    },
};
