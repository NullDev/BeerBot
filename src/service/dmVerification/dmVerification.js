import { BunDB } from "bun.db";
import { MessageFlags, EmbedBuilder } from "discord.js";
import Log from "../../util/log.js";
import gLogger from "../gLogger.js";
import { config } from "../../../config/config.js";
import { getAgeRole, calculateAge, removeExistingAgeRoles } from "./utils.js";
import { askBirthdayQuestion, askBirthdayPingQuestion } from "./questions.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Start DM verification process
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<void>}
 */
const startDMVerification = async function(interaction){
    // Check if user is already verified
    const isVerified = await db.get(`user-${interaction.user.id}.verified`);
    if (isVerified){
        await interaction.reply({
            content: "Du bist bereits verifiziert und konnst ned noamoi verifiziert werdn.",
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    try {
        // Send DM to user
        const dmEmbed = new EmbedBuilder()
            .setTitle("🔷┃BundesBeer Verifikation")
            .setDescription("Servas! Willkommen zur Verifikation!\n\nI werd da jetzt a paar Frogn stelln.\n\n**Du kannst jederzeit mit `stopp` obbrechn.**\n\n-# Info: Du konnst deine Daten jederzeit einsehen und löschen mit dem `/datenschutz` Befehl am Server.\n-# Wonnst den Server verlosst, werdn de automatisch glöscht.")
            .setColor(13111086);

        await interaction.user.send({
            embeds: [dmEmbed],
            files: [
                {
                    attachment: "assets/banner-crop.jpg",
                    name: "banner-crop.jpg",
                },
            ],
        });

        // Store verification state and start timeout
        await db.set(`user-${interaction.user.id}.verification_state`, "waiting_birthday");
        await db.set(`user-${interaction.user.id}.verification_guild`, interaction.guildId);
        await db.set(`user-${interaction.user.id}.verification_timeout`, Date.now() + (5 * 60 * 1000)); // 5 minutes

        // Send ephemeral message to channel
        await interaction.reply({
            content: "Schau in deine DMs!",
            flags: [MessageFlags.Ephemeral],
        });

        // Send first question
        await askBirthdayQuestion(interaction.user);
    }
    catch (error){
        Log.error(`Failed to start DM verification for user ${interaction.user.displayName}:`, error);
        await interaction.reply({
            content: "I konn da ka Privatnachricht sendn. Stell bitte sicha, dasst a Privatnachrichten von Servermitgliedern akzeptierst.",
            flags: [MessageFlags.Ephemeral],
        });
    }
};

/**
 * Clean up verification data
 *
 * @param {string} userId
 * @return {Promise<void>}
 */
const cleanupVerification = async function(userId){
    await db.delete(`user-${userId}.verification_state`);
    await db.delete(`user-${userId}.verification_guild`);
    await db.delete(`user-${userId}.verification_timeout`);
    await db.delete(`user-${userId}.temp_birthdate`);
    await db.delete(`user-${userId}.temp_is_full_date`);
    await db.delete(`user-${userId}.temp_age`);
};

/**
 * Complete verification process
 *
 * @param {import("discord.js").User} user
 * @param {import("discord.js").GuildMember} member
 * @param {boolean} shouldAddRole
 * @param {import("discord.js").Client} client
 * @return {Promise<void>}
 */
const completeVerification = async function(user, member, shouldAddRole, client){
    const userId = user.id;
    const birthdate = await db.get(`user-${userId}.temp_birthdate`);
    const age = calculateAge(birthdate);
    const ageRoleId = getAgeRole(age);

    try {
        // Remove existing age roles
        await removeExistingAgeRoles(member);

        // Add verified role
        if (config.roles.verified){
            await member.roles.add(config.roles.verified);
        }

        // Add age role
        if (ageRoleId){
            await member.roles.add(ageRoleId);
        }

        // Store user data in database
        await db.set(`user-${userId}.verified`, true);
        await db.set(`user-${userId}.birthdate`, birthdate);
        await db.set(`user-${userId}.birthday_ping`, shouldAddRole);

        // Clean up temporary data
        await cleanupVerification(userId);

        // Log success
        Log.done(`User ${user.displayName} has been verified via DM. Age: ${age}, Birthday ping: ${shouldAddRole}`);

        // Send success message to user
        const successEmbed = new EmbedBuilder()
            .setTitle("✅┃Verifikation erfolgreich!")
            .setDescription(`Du wurdest erfolgreich verifiziert!\n\n**Alter:** ${age} Jahre\n**Geburtstag Ping:** ${shouldAddRole ? "Jo" : "Na"}\n\nDu konnst jetzt olle Kanäle aufm Server sehen.`)
            .setColor(13111086);

        await user.send({
            embeds: [successEmbed],
        });

        // Log to guild
        await gLogger(
            { user, guild: member.guild, client },
            "🔷┃Verification Log - Erfolg",
            `Benutzer ${user} wurde erfolgreich verifiziert.\nAlter: ${age}\nGeburtstag Ping: ${shouldAddRole ? "Jo" : "Na"}`,
        );
    }
    catch (error){
        Log.error(`Error during DM verification for user ${user.displayName}:`, error);

        await user.send("❌ Es is a Fehler bei der Verifikation auftreten. Bitte versuachs später no amol oda kontaktier an Administrator.");

        await gLogger(
            { user, guild: member.guild, client },
            "🔷┃Verification Log - Error",
            `Fehler bei der Verifikation von ${user}:\n${error.message}`,
            "Red",
        );
    }
};

/**
 * Handle DM message for verification
 *
 * @param {import("discord.js").Message} message
 * @return {Promise<void>}
 */
const handleDMVerification = async function(message){
    if (message.author.bot) return;

    const userId = message.author.id;
    const verificationState = await db.get(`user-${userId}.verification_state`);
    const guildId = await db.get(`user-${userId}.verification_guild`);
    const timeout = await db.get(`user-${userId}.verification_timeout`);

    if (!verificationState || !guildId) return;

    // Check timeout
    if (timeout && Date.now() > timeout){
        await message.reply("⏰ Die Verifikation is obglaufn. Bitte starts no amol mitm Button aufm Server.");
        await cleanupVerification(userId);
        return;
    }

    // Check for abort
    const content = message.content.trim().toLowerCase();
    if (content === "stopp"){
        await message.reply("❌ Verifikation obbrochn. Du konnst jederzeit mitm Button aufm Server neich starten.");
        await cleanupVerification(userId);
        return;
    }

    const guild = message.client.guilds.cache.get(guildId);
    if (!guild){
        await message.reply("❌ Fehler: Server ned gfunden. Bitte versuachs no amol.");
        await cleanupVerification(userId);
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member){
        await message.reply("❌ Fehler: Du bist ned mehr aufm Server. Bitte tritt dem Server erneut bei.");
        await cleanupVerification(userId);
        return;
    }

    // Reset timeout
    await db.set(`user-${userId}.verification_timeout`, Date.now() + (5 * 60 * 1000));

    if (verificationState === "waiting_birthday"){
        const date = message.content.trim();
        const age = calculateAge(date);

        if (age === null){
            await message.reply("❌ Foisches Datumsformat. Bitte verwende entweda JJJJ (z.B. 1999) oda TT.MM.JJJJ (z.B. 25.01.1999).");
            return;
        }

        if (age < 14){
            await message.reply("❌ Du muasst mindestens 14 Jahre oit sein, um verifiziert z'werden.");
            return;
        }

        if (age > 120){
            await message.reply("❌ Des angegebene Alter scheint ned korrekt z'sein. Bitte überprüf dei Geburtsdatum.");
            return;
        }

        // Check if it's a full date (has day and month)
        const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(date);

        // Store birthdate and age for confirmation
        await db.set(`user-${userId}.temp_birthdate`, date);
        await db.set(`user-${userId}.temp_is_full_date`, isFullDate);
        await db.set(`user-${userId}.temp_age`, age);

        // Move to confirmation state
        await db.set(`user-${userId}.verification_state`, "waiting_confirmation");

        // Send confirmation message
        await message.reply(`**Sind de Daten korrekt? Sie kennan später NED mehr geändert werdn!**\n📅 ${date} - Alter: ${age} Jahre\n\nAntworte mit \`jo\` oder \`na\`.`);
    }
    else if (verificationState === "waiting_confirmation"){
        const confirmationAnswer = message.content.trim().toLowerCase();

        if (confirmationAnswer !== "jo" && confirmationAnswer !== "na"){
            await message.reply("❌ Bitte antwort mit `jo` oder `na`.");
            return;
        }

        if (confirmationAnswer === "na"){
            // User said no, go back to birthday question
            await db.set(`user-${userId}.verification_state`, "waiting_birthday");
            await message.reply("❌ Okay, bitte gib dein Geburtsdatum no amol ein.");
            await askBirthdayQuestion(message.author);
            return;
        }

        // User confirmed, proceed based on date type
        const isFullDate = await db.get(`user-${userId}.temp_is_full_date`);

        if (isFullDate){
            // Move to ping question
            await db.set(`user-${userId}.verification_state`, "waiting_ping");
            await message.reply("✅ Geburtsdatum bestätigt!");
            await askBirthdayPingQuestion(message.author);
        }
        else {
            // Complete verification without ping question
            await message.reply("✅ Geburtsdatum bestätigt! (Nur Jahr - keine Geburtstag-Pings möglich. Du konnst des später mit `/geburtstagsping` no hinzufügen)");
            await completeVerification(message.author, member, false, message.client);
        }
    }
    else if (verificationState === "waiting_ping"){
        const pingAnswer = message.content.trim().toLowerCase();
        const shouldAddRole = pingAnswer === "jo";

        if (pingAnswer !== "jo" && pingAnswer !== "na"){
            await message.reply("❌ Bitte antwort mit `jo` oder `na`.");
            return;
        }

        // Complete verification
        await completeVerification(message.author, member, shouldAddRole, message.client);
    }
};

export { startDMVerification, handleDMVerification };
