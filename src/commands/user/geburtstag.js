import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zeigt dei gspeichertes Geburtsdatum an.")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        const birthdate = await db.get(`user-${interaction.user.id}.birthdate`);
        const birthdayPing = await db.get(`user-${interaction.user.id}.birthday_ping`);

        if (!birthdate){
            return await interaction.reply({
                content: "Du hast noch kein Geburtsdatum gespeichert. Verifiziere dich zuerst mit dem Button auf dem Server!",
                flags: [MessageFlags.Ephemeral],
            });
        }

        const pingStatus = birthdayPing ? "Ja" : "Nein";
        const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);
        const dateType = isFullDate ? "Vollständiges Datum" : "Nur Jahr";

        return await interaction.reply({
            content: `**Dein Geburtsdatum:**\n📅 ${birthdate}\n\n**Typ:** ${dateType}\n🎂 **Geburtstag-Ping:** ${pingStatus}`,
            flags: [MessageFlags.Ephemeral],
        });
    },
};
