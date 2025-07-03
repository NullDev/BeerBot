import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags } from "discord.js";

const db = new BunDB("./data/guild_data.sqlite");

const commandName = "daten";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zeigt dei gespeicherten Verifikationsdaten an.")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply({
                flags: [MessageFlags.Ephemeral],
            });
        }

        const birthdate = await db.get(`user-${interaction.user.id}.birthdate`);
        const birthdayPing = await db.get(`user-${interaction.user.id}.birthday_ping`);
        const gender = await db.get(`user-${interaction.user.id}.gender`);

        if (!birthdate){
            if (interaction.deferred){
                return await interaction.editReply({
                    content: "Du host no kane Daten gespeichert. Verifiziere di zuerst mit dem Button auf dem Server!",
                });
            }
            return await interaction.reply({
                content: "Du host no kane Daten gespeichert. Verifiziere di zuerst mit dem Button auf dem Server!",
                flags: [MessageFlags.Ephemeral],
            });
        }

        const pingStatus = birthdayPing ? "Jo" : "Na";
        const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);
        const dateType = isFullDate ? "Vollständiges Datum" : "Nur Jahr";
        let genderText = "Nicht angegeben";
        if (gender === "male") genderText = "Männlich";
        else if (gender === "female") genderText = "Weiblich";
        else if (gender === "divers") genderText = "Divers";

        const responseContent = `**Deine Daten:**\n\n📅 **Geburtsdatum:** ${birthdate}\n🔎 **Typ:** ${dateType}\n🎂 **Geburtstag-Ping:** ${pingStatus}\n👤 **Geschlecht:** ${genderText}`;

        if (interaction.deferred){
            return await interaction.editReply({
                content: responseContent,
            });
        }
        return await interaction.reply({
            content: responseContent,
            flags: [MessageFlags.Ephemeral],
        });
    },
};
