import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "../../../config/config.js";
import Log from "../../util/log.js";
import gLogger from "../../service/gLogger.js";
import { getAgeRole, calculateAge, removeExistingAgeRoles } from "../../service/dmVerification/utils.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

/**
 * Set user birthday manually
 *
 * @param {import("discord.js").User} user
 * @param {import("discord.js").GuildMember} member
 * @param {string} birthdate
 * @param {boolean} birthdayPing
 * @param {string} gender
 * @param {import("../../types.js").CommandInteractionWithOptions} interaction
 * @return {Promise<boolean>}
 */
const setUserBirthday = async function(user, member, birthdate, birthdayPing, gender, interaction){
    const userId = user.id;
    const age = calculateAge(birthdate);
    if (!age) return false;
    const ageRoleId = getAgeRole(age);
    const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);

    try {
        if (age === null) throw new Error("Ungültiges Datumsformat. Verwende JJJJ (z.B. 1999) oder TT.MM.JJJJ (z.B. 25.01.1999).");

        if (age < 13) throw new Error("Benutzer muass mindestens 13 Jahre oid sein.");

        if (age > 120) throw new Error("Des angegebene Alter scheint ned korrekt zu sein.");

        await removeExistingAgeRoles(member);

        if (config.roles.unverified && member.roles.cache.has(config.roles.unverified)){
            await member.roles.remove(config.roles.unverified);
        }

        if (config.roles.verified && !member.roles.cache.has(config.roles.verified)) await member.roles.add(config.roles.verified);

        if (ageRoleId) await member.roles.add(ageRoleId);

        if (gender && config.roles.gender[gender] && !member.roles.cache.has(config.roles.gender[gender])) await member.roles.add(config.roles.gender[gender]);

        await db.set(`user-${userId}.verified`, true);
        await db.set(`user-${userId}.birthdate`, birthdate);
        await db.set(`user-${userId}.birthday_ping`, birthdayPing);
        await db.set(`user-${userId}.gender`, gender);

        const admin = interaction.user;

        const dateType = isFullDate ? "Vollständiges Datum" : "Nur Jahr";
        Log.done(`Admin ${admin.displayName} set birthday for user ${user.displayName}: ${birthdate} (Age: ${age}, Ping: ${birthdayPing}, Gender: ${gender}, Date type: ${dateType})`);

        await gLogger( // @ts-ignore
            interaction,
            "🔷┃Admin Action - Birthday Set",
            `Admin ${admin} hat Geburtstag für ${user} gesetzt.\nGeburtsdatum: ${birthdate}\nAlter: ${age}\nGeburtstag Ping: ${birthdayPing ? "Jo" : "Na"}\nGeschlecht: ${gender}\nDatumstyp: ${dateType}`,
        );

        return true;
    }
    catch (error){
        Log.error(`Error setting birthday for user ${user.displayName}:`, error);

        await gLogger( // @ts-ignore
            interaction,
            "🔷┃Admin Action - Birthday Set Error",
            `Fehler beim Setzen des Geburtstags für ${user}:\n${error.message}`,
            "Red",
        );

        return false;
    }
};

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Setze den Geburtstag von am Benutzer manuell.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Der Benutzer, dessen Geburtstag gsetzt werdn sui")
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName("geburtstag")
                .setDescription("Geburtsdatum (JJJJ oder TT.MM.JJJJ)")
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName("gender")
                .setDescription("Geschlecht (male, female, divers)")
                .setRequired(true)
                .addChoices(
                    { name: "Männlich", value: "male" },
                    { name: "Weiblich", value: "female" },
                    { name: "Divers", value: "divers" },
                ),
        )
        .addBooleanOption(option =>
            option
                .setName("geburtstag_ping")
                .setDescription("Sui der Benutzer Geburtstag-Pings erholtn?")
                .setRequired(false),
        ),
    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply({
                flags: [MessageFlags.Ephemeral],
            });
        }

        try {
            const targetUser = interaction.options.getUser("user");
            if (!targetUser){
                return await interaction.reply({
                    content: "❌ Benutzer is ned aufm Server.",
                    flags: [MessageFlags.Ephemeral],
                });
            }
            const birthdate = interaction.options.getString("geburtstag");
            if (!birthdate){
                return await interaction.reply({
                    content: "❌ Geburtsdatum is ned gsetzt.",
                    flags: [MessageFlags.Ephemeral],
                });
            }
            const gender = interaction.options.getString("gender");
            if (!gender){
                return await interaction.reply({
                    content: "❌ Geschlecht is ned gsetzt.",
                    flags: [MessageFlags.Ephemeral],
                });
            }
            const birthdayPing = interaction.options.getBoolean("geburtstag_ping") ?? false;

            const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
            if (!member){
                if (interaction.deferred){
                    await interaction.editReply({
                        content: "❌ Benutzer is ned aufm Server.",
                    });
                }
                else {
                    await interaction.reply({
                        content: "❌ Benutzer is ned aufm Server.",
                        flags: [MessageFlags.Ephemeral],
                    });
                }
                return null;
            }

            const isVerified = await db.get(`user-${targetUser.id}.verified`);
            const currentBirthdate = await db.get(`user-${targetUser.id}.birthdate`);

            const confirmEmbed = new EmbedBuilder()
                .setTitle("🔷┃Daten setzen")
                .setDescription(`**Benutzer:** ${targetUser}\n**Geburtsdatum:** ${birthdate}\n**Geschlecht:** ${gender}\n**Geburtstag Ping:** ${birthdayPing ? "Jo" : "Na"}`)
                .addFields(
                    { name: "Aktueller Status", value: isVerified ? "✅ Verifiziert" : "❌ Nicht verifiziert", inline: true },
                    { name: "Aktuelles Geburtsdatum", value: currentBirthdate || "Nicht gesetzt", inline: true },
                )
                .setColor(13111086)
                .setFooter({
                    text: "Diese Aktion überschreibt olle bestehenden Verifikationsdaten!",
                });

            if (interaction.deferred){
                await interaction.editReply({
                    embeds: [confirmEmbed],
                });
            }
            else {
                await interaction.reply({
                    embeds: [confirmEmbed],
                    flags: [MessageFlags.Ephemeral],
                });
            }

            const success = await setUserBirthday(targetUser, member, birthdate, birthdayPing, gender, interaction);

            if (success){
                const successEmbed = new EmbedBuilder()
                    .setTitle("✅┃Daten erfolgreich gesetzt")
                    .setDescription(`Die Daten von ${targetUser} wurd erfolgreich gsetzt.\n\n**Geburtsdatum:** ${birthdate}\n**Alter:** ${calculateAge(birthdate)} Jahre\n**Geschlecht:** ${gender}\n**Geburtstag Ping:** ${birthdayPing ? "Jo" : "Na"}`)
                    .setColor(13111086);

                await interaction.followUp({
                    embeds: [successEmbed],
                    flags: [MessageFlags.Ephemeral],
                });
            }
            else {
                await interaction.followUp({
                    content: "❌ Es is a Fehler beim Setzen der Daten auftreten. Bitte überprüfe de Eingabe und versuachs no amol.",
                    flags: [MessageFlags.Ephemeral],
                });
            }

            return null;
        }
        catch (error){
            Log.error("Error in user-bday-setzen command:", error);

            const errorMessage = "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.";

            if (interaction.deferred){
                await interaction.editReply({
                    content: errorMessage,
                });
            }
            else {
                await interaction.reply({
                    content: errorMessage,
                    flags: [MessageFlags.Ephemeral],
                });
            }

            return null;
        }
    },
};
