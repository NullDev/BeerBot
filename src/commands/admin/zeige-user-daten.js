import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { calculateAge } from "../../service/dmVerification/utils.js";
import Log from "../../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zagt die gespeicherten Verifikationsdaten von am Benutzer an.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Der Benutzer, dessen Daten onzagt werden sui.")
                .setRequired(true),
        ),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        try {
            const targetUser = interaction.options.getUser("user");
            const userId = targetUser.id;

            const birthdate = await db.get(`user-${userId}.birthdate`);
            const birthdayPing = await db.get(`user-${userId}.birthday_ping`);
            const gender = await db.get(`user-${userId}.gender`);
            const isVerified = await db.get(`user-${userId}.verified`);

            if (!birthdate){
                const noDataEmbed = new EmbedBuilder()
                    .setTitle("❌┃Keine Daten gefunden")
                    .setDescription(`${targetUser} hot no kane Verifikationsdaten gspeichert.`)
                    .setColor(15158332)
                    .setTimestamp();

                return await interaction.reply({
                    embeds: [noDataEmbed],
                    flags: [MessageFlags.Ephemeral],
                });
            }

            const age = calculateAge(birthdate);
            const pingStatus = birthdayPing ? "Jo" : "Na";
            const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);
            const dateType = isFullDate ? "Vollständiges Datum" : "Nur Jahr";

            let genderText = "Nicht angegeben";
            if (gender === "male") genderText = "Männlich";
            else if (gender === "female") genderText = "Weiblich";
            else if (gender === "divers") genderText = "Divers";

            const userDataEmbed = new EmbedBuilder()
                .setTitle("🔷┃Benutzerdaten")
                .setDescription(`**Benutzer:** ${targetUser}`)
                .addFields(
                    { name: "Verifikationsstatus", value: isVerified ? "✅ Verifiziert" : "❌ Nicht verifiziert", inline: true },
                    { name: "Geburtsdatum", value: birthdate, inline: true },
                    { name: "Alter", value: age ? `${age} Jahre` : "Unbekannt", inline: true },
                    { name: "Datentyp", value: dateType, inline: true },
                    { name: "Geburtstag-Ping", value: pingStatus, inline: true },
                    { name: "Geschlecht", value: genderText, inline: true },
                )
                .setColor(13111086)
                .setThumbnail(targetUser.displayAvatarURL())
                .setTimestamp();

            return await interaction.reply({
                embeds: [userDataEmbed],
                flags: [MessageFlags.Ephemeral],
            });
        }
        catch (error){
            Log.error("Error in zeige-user-daten command:", error);
            return await interaction.reply({
                content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
                flags: [MessageFlags.Ephemeral],
            });
        }
    },
};
