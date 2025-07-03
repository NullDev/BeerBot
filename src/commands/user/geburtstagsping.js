import { BunDB } from "bun.db";
import {
    SlashCommandBuilder,
    InteractionContextType,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import Log from "../../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Geburtstagsping verwalten oder vollständiges Geburtsdatum nachtragen.")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        try {
            const userId = interaction.user.id;
            const birthdate = await db.get(`user-${userId}.birthdate`);
            const birthdayPing = await db.get(`user-${userId}.birthday_ping`);

            if (!birthdate){
                return await interaction.reply({
                    content: "Du host no kane Daten gespeichert. Verifiziere di zuerst mit dem Button auf dem Server!",
                    flags: [MessageFlags.Ephemeral],
                });
            }

            const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);

            if (!isFullDate){
                const modal = new ModalBuilder()
                    .setCustomId("set_full_birthdate")
                    .setTitle("Vollständiges Geburtsdatum nachtragen")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("full_birthdate")
                                .setLabel("Vollständiges Geburtsdatum (TT.MM.JJJJ)")
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder("z.B. 25.01.1999")
                                .setRequired(true),
                        ),
                    );
                return await interaction.showModal(modal);
            }

            const pingStatus = birthdayPing ? "Jo (aktiviert)" : "Na (deaktiviert)";
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("toggle_birthday_ping")
                    .setLabel(birthdayPing ? "Geburtstagsping deaktivieren" : "Geburtstagsping aktivieren")
                    .setStyle(birthdayPing ? ButtonStyle.Danger : ButtonStyle.Success)
                    .setEmoji("🎂"),
            );
            return await interaction.reply({
                content: `🎂 **Geburtstagsping Status:** ${pingStatus}`,
                components: [row],
                flags: [MessageFlags.Ephemeral],
            });
        }
        catch (error){
            Log.error("Error in geburtstagsping command", error);
            return await interaction.reply({
                content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
                flags: [MessageFlags.Ephemeral],
            });
        }
    },
};
