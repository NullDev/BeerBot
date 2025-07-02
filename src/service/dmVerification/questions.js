import { EmbedBuilder } from "discord.js";

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
        .setDescription("Wüst du an deinem Geburtstag a spezielle Rolle bekommen und gepingt werdn?\n\n**Antworte mit:**\n• `jo` - Du wirst gepingt\n• `na` - Du wirst ned gepingt\n\n**Achtung:** Des funktioniert nur, wennst a vollständiges Geburtsdatum ongeben host!")
        .setColor(13111086);

    await user.send({
        embeds: [embed],
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
