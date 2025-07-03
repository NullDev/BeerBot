import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Ask birthday ping question
 *
 * @param {import("discord.js").User} user
 * @return {Promise<void>}
 */
export const askBirthdayPingQuestion = async function(user){
    const embed = new EmbedBuilder()
        .setTitle("🎂┃Geburtstags Ping")
        .setDescription("Wüst du an deinem Geburtstag a spezielle Rolle bekommen und gepingt werdn?\n\n**Klick auf einen der Buttons unten:**\n\n**Achtung:** Des funktioniert nur, wennst a vollständiges Geburtsdatum ongeben host!")
        .setColor(13111086);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("birthday_ping_yes")
                .setLabel("Jo, ping mi!")
                .setStyle(ButtonStyle.Success)
                .setEmoji("🎂"),
            new ButtonBuilder()
                .setCustomId("birthday_ping_no")
                .setLabel("Na, danke")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("❌"),
        );

    await user.send({
        embeds: [embed],
        components: [row],
    });
};

/**
 * Ask gender selection question
 *
 * @param {import("discord.js").User} user
 * @return {Promise<void>}
 */
export const askGenderQuestion = async function(user){
    const embed = new EmbedBuilder()
        .setTitle("👤┃Geschlecht")
        .setDescription("Wähle dei Geschlecht aus der Liste unten aus.\n\n**Hinweis:** Diese Auswahl konn später nur von am Admin geändert werdn.")
        .setColor(13111086);

    const row = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("gender_selection")
                .setPlaceholder("Wähle dei Geschlecht...")
                .addOptions([
                    {
                        label: "Männlich",
                        description: "I identifizier mi als männlich",
                        value: "male",
                        emoji: "👨",
                    },
                    {
                        label: "Weiblich",
                        description: "I identifizier mi als weiblich",
                        value: "female",
                        emoji: "👩",
                    },
                    {
                        label: "Divers",
                        description: "I identifizier mi als divers",
                        value: "divers",
                        emoji: "🌈",
                    },
                ]),
        );

    await user.send({
        embeds: [embed],
        components: [row],
    });
};

/**
 * Ask birthday question
 *
 * @param {import("discord.js").User} user
 * @return {Promise<void>}
 */
export const askBirthdayQuestion = async function(user){
    const embed = new EmbedBuilder()
        .setTitle("📅┃Geburtsdatum")
        .setDescription("Dei Geburtsdatum. Entweder vollständig (TT.MM.JJJJ) oder nur des Jahr (JJJJ).\n\n**Beispiele:**\n• 25.01.1999\n• 1999\n\n**Hinweis:** Nur mit vollständigem Datum konnst du späta Geburtstag-Pings erhoitn!")
        .setColor(13111086);

    await user.send({
        embeds: [embed],
    });
};
