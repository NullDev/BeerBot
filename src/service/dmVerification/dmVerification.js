import { BunDB } from "bun.db";
import { MessageFlags, EmbedBuilder } from "discord.js";
import Log from "../../util/log.js";
import gLogger from "../gLogger.js";
import { config } from "../../../config/config.js";
import { getAgeRole, calculateAge, removeExistingAgeRoles } from "./utils.js";
import { askBirthdayQuestion, askBirthdayPingQuestion, askGenderQuestion } from "./questions.js";
import welcomeHandler from "../welcomeHandler.js";

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
    const isVerified = await db.get(`user-${interaction.user.id}.verified`);
    if (isVerified){
        await interaction.reply({
            content: "Du bist bereits verifiziert und konnst ned noamoi verifiziert werdn.",
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    // Defer the reply immediately to prevent timeout issues
    if (!interaction.deferred && !interaction.replied){
        await interaction.deferReply({
            flags: [MessageFlags.Ephemeral],
        });
    }

    try {
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

        await db.set(`user-${interaction.user.id}.verification_state`, "waiting_birthday");
        await db.set(`user-${interaction.user.id}.verification_guild`, interaction.guildId);
        await db.set(`user-${interaction.user.id}.verification_timeout`, Date.now() + (5 * 60 * 1000)); // 5 minutes

        await askBirthdayQuestion(interaction.user);

        if (interaction.deferred){
            await interaction.editReply({
                content: "Schau in deine DMs!",
            });
        }
        else {
            await interaction.reply({
                content: "Schau in deine DMs!",
                flags: [MessageFlags.Ephemeral],
            });
        }
    }
    catch (error){
        Log.error(`Failed to start DM verification for user ${interaction.user.displayName}:`, error);

        const errorMessage = "I konn da ka Privatnachricht sendn. Stell bitte sicha, dasst a Privatnachrichten von Servermitgliedern akzeptierst.";

        if (interaction.deferred){
            await interaction.editReply({
                content: errorMessage,
            });
        }
        else if (!interaction.replied){
            await interaction.reply({
                content: errorMessage,
                flags: [MessageFlags.Ephemeral],
            });
        }
        else {
            await interaction.followUp({
                content: errorMessage,
                flags: [MessageFlags.Ephemeral],
            });
        }
    }
};

/**
 * Clean up verification data
 *
 * @param {string} userId
 * @param {import("discord.js").GuildMember | null} [member]
 * @return {Promise<void>}
 */
const cleanupVerification = async function(userId, member = null){
    await db.delete(`user-${userId}.verification_state`);
    await db.delete(`user-${userId}.verification_guild`);
    await db.delete(`user-${userId}.verification_timeout`);
    await db.delete(`user-${userId}.temp_birthdate`);
    await db.delete(`user-${userId}.temp_is_full_date`);
    await db.delete(`user-${userId}.temp_age`);
    await db.delete(`user-${userId}.temp_birthday_ping`);
    await db.delete(`user-${userId}.temp_gender`);
    await db.delete(`user-${userId}.unverified_join_time`);

    if (member && config.roles.unverified && !member.roles.cache.has(config.roles.verified)){
        if (!member.roles.cache.has(config.roles.unverified)){
            await member.roles.add(config.roles.unverified);
        }
    }
};

/**
 * Handle country role transition during verification
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<string|null>}
 */
const handleCountryRoleTransition = async function(member){
    for (const [countryCode, roleId] of Object.entries(config.roles.country_unverified)){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId);

            const verifiedRoleId = config.roles.country_verified[countryCode];
            if (verifiedRoleId){
                await member.roles.add(verifiedRoleId);
            }

            return countryCode;
        }
    }
    return null;
};

/**
 * Complete verification process
 *
 * @param {import("discord.js").User} user
 * @param {import("discord.js").GuildMember} member
 * @param {boolean} shouldAddRole
 * @return {Promise<void>}
 */
const completeVerification = async function(user, member, shouldAddRole){
    const userId = user.id;
    const birthdate = await db.get(`user-${userId}.temp_birthdate`);
    const age = calculateAge(birthdate);
    if (!age) return;
    const ageRoleId = getAgeRole(age);
    const gender = await db.get(`user-${userId}.temp_gender`);
    const isFullDate = await db.get(`user-${userId}.temp_is_full_date`);

    try {
        await removeExistingAgeRoles(member);

        let countryCode;
        try {
            countryCode = await handleCountryRoleTransition(member);
        }
        catch (error){
            Log.error(`Error during country role transition for user ${user.displayName}:`, error);
        }

        if (config.roles.unverified && member.roles.cache.has(config.roles.unverified)){
            await member.roles.remove(config.roles.unverified);
        }

        if (config.roles.verified){
            await member.roles.add(config.roles.verified);
        }

        if (ageRoleId){
            await member.roles.add(ageRoleId);
        }

        if (gender && config.roles.gender[gender]){
            await member.roles.add(config.roles.gender[gender]);
        }

        await db.set(`user-${userId}.verified`, true);
        await db.set(`user-${userId}.birthdate`, birthdate);
        await db.set(`user-${userId}.birthday_ping`, shouldAddRole);
        if (gender){
            await db.set(`user-${userId}.gender`, gender);
        }

        await cleanupVerification(userId);

        const dateType = isFullDate ? "Vollständiges Datum" : "Nur Jahr";
        const countryText = countryCode ? countryCode.toUpperCase() : "";
        Log.done(`User ${user.displayName} has been verified via DM. Age: ${age}, Birthday ping: ${shouldAddRole}, Gender: ${gender}, Date type: ${dateType}, Bundesland: ${countryText}`);

        let genderText = "Nicht angegeben";
        if (gender === "male") genderText = "Männlich";
        else if (gender === "female") genderText = "Weiblich";
        else if (gender === "divers") genderText = "Divers";
        const successEmbed = new EmbedBuilder()
            .setTitle("✅┃Verifikation erfolgreich!")
            .setDescription(`Du wurdest erfolgreich verifiziert!\n\n**Alter:** ${age} Jahre\n**Geschlecht:** ${genderText}\n**Geburtstag Ping:** ${shouldAddRole ? "Jo" : "Na"}\n\nDu konnst jetzt olle Kanäle aufm Server sehen.`)
            .setColor(13111086);

        await user.send({
            embeds: [successEmbed],
        });

        const dateText = isFullDate ? `Geburtsdatum: ${birthdate}` : `Geburtsjahr: ${birthdate}`;
        await gLogger(
            { user, guild: member.guild, client: member.client },
            "🔷┃Verification Log - Erfolg",
            `Benutzer ${user} wurde erfolgreich verifiziert.\nAlter: ${age}\nGeschlecht: ${genderText}\nGeburtstag Ping: ${shouldAddRole ? "Jo" : "Na"}\nDatumstyp: ${dateType}\nBundesland: ${countryText}\n${dateText}`,
        );

        await welcomeHandler(member);
    }
    catch (error){
        Log.error(`Error during DM verification for user ${user.displayName}:`, error);

        await user.send("❌ Es is a Fehler bei der Verifikation auftreten. Bitte versuachs später no amol oda kontaktier an Administrator.");

        await gLogger(
            { user, guild: member.guild, client: member.client },
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

    if (timeout && Date.now() > timeout){
        await message.reply("⏰ Die Verifikation is obglaufn. Bitte starts no amol mitm Button aufm Server.");
        await cleanupVerification(userId, member);
        return;
    }

    const content = message.content.trim().toLowerCase();
    if (content === "stopp"){
        await message.reply("❌ Verifikation obbrochn. Du konnst jederzeit mitm Button aufm Server neich starten.");
        await cleanupVerification(userId, member);
        return;
    }

    await db.set(`user-${userId}.verification_timeout`, Date.now() + (5 * 60 * 1000));

    if (verificationState === "waiting_birthday"){
        const date = message.content.trim();
        const age = calculateAge(date);

        if (age === null){
            await message.reply("❌ Foisches Datumsformat. Bitte verwende entweda JJJJ (z.B. 1999) oda TT.MM.JJJJ (z.B. 25.01.1999).");
            return;
        }

        if (age < 13){
            await message.reply("❌ Du muasst mindestens 13 Jahre alt sein, um auf dem server zu sein. Du wurdest jetzt vom Server entfernt.");
            await member.kick("Nutzer ist unter 13.").catch((error) => {
                Log.error(`Failed to kick user ${message.author.tag}:`, error);
            });
            await gLogger(
                { user: message.author, guild: member.guild, client: member.client },
                "🔷┃Verification Log - Warnung",
                `Benutzer ${message.author} wurde vom Server entfernt, da er unter 13 Jahre alt is.\nAlter: ${age}\nGeburtsdatum: ${date}`,
                "Red",
            );
            Log.warn(`User ${message.author.tag} wurde vom Server entfernt, da er unter 13 Jahre alt is. Alter: ${age}, Geburtsdatum: ${date}`);
            await cleanupVerification(userId, member);
            return;
        }

        if (age > 120){
            await message.reply("❌ Des angegebene Alter scheint ned korrekt z'sein. Bitte überprüf dei Geburtsdatum.");
            return;
        }

        const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(date);

        await db.set(`user-${userId}.temp_birthdate`, date);
        await db.set(`user-${userId}.temp_is_full_date`, isFullDate);
        await db.set(`user-${userId}.temp_age`, age);

        await db.set(`user-${userId}.verification_state`, "waiting_confirmation");

        await message.reply(`**Sand de Daten korrekt? Sie kennan später NED mehr geändert werdn!**\n📅 ${date} - Alter: ${age} Jahre${!isFullDate ? "\n\n-# Achtung. Du host nur des Jahr angegeben also konnst kan Geburtstagsping erhoitn" : ""}\n\nAntworte mit \`jo\` oder \`na\`.`);
    }
    else if (verificationState === "waiting_confirmation"){
        const confirmationAnswer = message.content.trim().toLowerCase();

        if (confirmationAnswer !== "jo" && confirmationAnswer !== "na"){
            await message.reply("❌ Bitte antwort mit `jo` oder `na`.");
            return;
        }

        if (confirmationAnswer === "na"){
            await db.set(`user-${userId}.verification_state`, "waiting_birthday");
            await message.reply("❌ Okay, bitte gib dein Geburtsdatum no amol ein.");
            await askBirthdayQuestion(message.author);
            return;
        }

        const isFullDate = await db.get(`user-${userId}.temp_is_full_date`);

        if (isFullDate){
            await db.set(`user-${userId}.verification_state`, "waiting_ping");
            await message.reply("✅ Geburtsdatum bestätigt!");
            await askBirthdayPingQuestion(message.author);
        }
        else {
            await db.set(`user-${userId}.temp_birthday_ping`, false);
            await db.set(`user-${userId}.verification_state`, "waiting_gender");
            await message.reply("✅ Geburtsdatum bestätigt! (Nur Jahr - keine Geburtstag-Pings möglich. Du konnst des später mit `/geburtstagsping` no hinzufügen)");
            await askGenderQuestion(message.author);
        }
    }
    else if (verificationState === "waiting_ping"){
        await message.reply("❌ Bitte verwende die Buttons in der vorherigen Nachricht, um deine Entscheidung zu treffen.");
        return;
    }
};

/**
 * Handle birthday ping button interaction
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 * @return {Promise<void>}
 */
const handleBirthdayPingButton = async function(interaction){
    const userId = interaction.user.id;
    const verificationState = await db.get(`user-${userId}.verification_state`);
    const guildId = await db.get(`user-${userId}.verification_guild`);

    if (!verificationState || !guildId || verificationState !== "waiting_ping"){
        await interaction.reply({
            content: "❌ Du bist ned in der Verifikation oder der falsche Schritt.",
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild){
        await interaction.reply({
            content: "❌ Fehler: Server ned gfunden. Bitte versuachs no amol.",
            flags: [MessageFlags.Ephemeral],
        });
        await cleanupVerification(userId);
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member){
        await interaction.reply({
            content: "❌ Fehler: Du bist ned mehr aufm Server. Bitte tritt dem Server erneut bei.",
            flags: [MessageFlags.Ephemeral],
        });
        await cleanupVerification(userId, member);
        return;
    }

    const shouldAddRole = interaction.customId === "birthday_ping_yes";

    await db.set(`user-${userId}.temp_birthday_ping`, shouldAddRole);

    await interaction.update({
        components: [],
    });

    await db.set(`user-${userId}.verification_state`, "waiting_gender");

    await askGenderQuestion(interaction.user);
};

/**
 * Handle gender selection interaction
 *
 * @param {import("discord.js").StringSelectMenuInteraction} interaction
 * @return {Promise<void>}
 */
const handleGenderSelection = async function(interaction){
    const userId = interaction.user.id;
    const verificationState = await db.get(`user-${userId}.verification_state`);
    const guildId = await db.get(`user-${userId}.verification_guild`);

    if (!verificationState || !guildId || verificationState !== "waiting_gender"){
        await interaction.reply({
            content: "❌ Du bist ned in der Verifikation oder der falsche Schritt.",
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    const guild = interaction.client.guilds.cache.get(guildId);
    if (!guild){
        await interaction.reply({
            content: "❌ Fehler: Server ned gfunden. Bitte versuachs no amol.",
            flags: [MessageFlags.Ephemeral],
        });
        await cleanupVerification(userId);
        return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member){
        await interaction.reply({
            content: "❌ Fehler: Du bist ned mehr aufm Server. Bitte tritt dem Server erneut bei.",
            flags: [MessageFlags.Ephemeral],
        });
        await cleanupVerification(userId, member);
        return;
    }

    const selectedGender = interaction.values[0];
    const birthdayPing = await db.get(`user-${userId}.temp_birthday_ping`);

    await db.set(`user-${userId}.temp_gender`, selectedGender);

    await interaction.update({
        components: [],
    });

    await completeVerification(interaction.user, member, birthdayPing);
};

export { startDMVerification, handleDMVerification, handleBirthdayPingButton, handleGenderSelection };
