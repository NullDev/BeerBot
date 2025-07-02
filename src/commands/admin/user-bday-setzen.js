import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder } from "discord.js";
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
 * @return {Promise<boolean>}
 */
const setUserBirthday = async function(user, member, birthdate, birthdayPing){
    const userId = user.id;
    const age = calculateAge(birthdate);
    const ageRoleId = getAgeRole(age);

    try {
        // Validate age
        if (age === null){
            throw new Error("Ungültiges Datumsformat. Verwende JJJJ (z.B. 1999) oder TT.MM.JJJJ (z.B. 25.01.1999).");
        }

        if (age < 14){
            throw new Error("Benutzer muss mindestens 14 Jahre alt sein.");
        }

        if (age > 120){
            throw new Error("Das angegebene Alter scheint nicht korrekt zu sein.");
        }

        // Remove existing age roles
        await removeExistingAgeRoles(member);

        // Add verified role if not already present
        if (config.roles.verified && !member.roles.cache.has(config.roles.verified)){
            await member.roles.add(config.roles.verified);
        }

        // Add age role
        if (ageRoleId){
            await member.roles.add(ageRoleId);
        }

        // Store user data in database
        await db.set(`user-${userId}.verified`, true);
        await db.set(`user-${userId}.birthdate`, birthdate);
        await db.set(`user-${userId}.birthday_ping`, birthdayPing);

        // Log success
        Log.done(`Admin set birthday for user ${user.displayName}: ${birthdate} (Age: ${age}, Ping: ${birthdayPing})`);

        // Log to guild
        await gLogger(
            { user, guild: member.guild, client: member.client },
            "🔷┃Admin Action - Birthday Set",
            `Admin hat Geburtstag für ${user} gesetzt.\nGeburtsdatum: ${birthdate}\nAlter: ${age}\nGeburtstag Ping: ${birthdayPing ? "Jo" : "Na"}`,
        );

        return true;
    }
    catch (error){
        Log.error(`Error setting birthday for user ${user.displayName}:`, error);

        await gLogger(
            { user, guild: member.guild, client: member.client },
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
        .setDescription("Setze den Geburtstag eines Benutzers manuell (Admin only).")
        .setContexts([InteractionContextType.Guild])
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Der Benutzer, dessen Geburtstag gesetzt werden soll")
                .setRequired(true),
        )
        .addStringOption(option =>
            option
                .setName("geburtstag")
                .setDescription("Geburtsdatum (JJJJ oder TT.MM.JJJJ)")
                .setRequired(true),
        )
        .addBooleanOption(option =>
            option
                .setName("geburtstag_ping")
                .setDescription("Soll der Benutzer Geburtstag-Pings erhalten?")
                .setRequired(false),
        ),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        try {
            // Check if user has admin permissions
            if (!interaction.member.permissions.has("Administrator")){
                await interaction.reply({
                    content: "❌ Du hast keine Berechtigung für diesen Befehl.",
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }

            const targetUser = interaction.options.getUser("user");
            const birthdate = interaction.options.getString("geburtstag");
            const birthdayPing = interaction.options.getBoolean("geburtstag_ping") ?? false;

            // Get the member object
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member){
                await interaction.reply({
                    content: "❌ Benutzer ist nicht auf diesem Server.",
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }

            // Check if user is already verified
            const isVerified = await db.get(`user-${targetUser.id}.verified`);
            const currentBirthdate = await db.get(`user-${targetUser.id}.birthdate`);

            // Show confirmation embed
            const confirmEmbed = new EmbedBuilder()
                .setTitle("🔷┃Geburtstag setzen")
                .setDescription(`**Benutzer:** ${targetUser}\n**Geburtsdatum:** ${birthdate}\n**Geburtstag Ping:** ${birthdayPing ? "Jo" : "Na"}`)
                .addFields(
                    { name: "Aktueller Status", value: isVerified ? "✅ Verifiziert" : "❌ Nicht verifiziert", inline: true },
                    { name: "Aktuelles Geburtsdatum", value: currentBirthdate || "Nicht gesetzt", inline: true },
                )
                .setColor(13111086)
                .setFooter({
                    text: "Diese Aktion überschreibt alle bestehenden Verifikationsdaten!",
                });

            await interaction.reply({
                embeds: [confirmEmbed],
                flags: [MessageFlags.Ephemeral],
            });

            // Set the birthday
            const success = await setUserBirthday(targetUser, member, birthdate, birthdayPing);

            if (success){
                const successEmbed = new EmbedBuilder()
                    .setTitle("✅┃Geburtstag erfolgreich gesetzt")
                    .setDescription(`Der Geburtstag von ${targetUser} wurde erfolgreich gesetzt.\n\n**Geburtsdatum:** ${birthdate}\n**Alter:** ${calculateAge(birthdate)} Jahre\n**Geburtstag Ping:** ${birthdayPing ? "Jo" : "Na"}`)
                    .setColor(13111086);

                await interaction.followUp({
                    embeds: [successEmbed],
                    flags: [MessageFlags.Ephemeral],
                });
            }
            else {
                await interaction.followUp({
                    content: "❌ Es ist ein Fehler beim Setzen des Geburtstags aufgetreten. Bitte überprüfe die Eingabe und versuche es erneut.",
                    flags: [MessageFlags.Ephemeral],
                });
            }
        }
        catch (error){
            Log.error("Error in user-bday-setzen command:", error);
            await interaction.reply({
                content: "❌ Es ist ein Fehler aufgetreten. Bitte versuche es später erneut.",
                flags: [MessageFlags.Ephemeral],
            });
        }
    },
};
