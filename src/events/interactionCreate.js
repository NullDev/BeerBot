import { BunDB } from "bun.db";
import { MessageFlags, ButtonStyle } from "discord.js";
import { startDMVerification, handleBirthdayPingButton, handleGenderSelection } from "../service/dmVerification/dmVerification.js";
import { getAgeRole, removeExistingAgeRoles } from "../service/dmVerification/utils.js";
import { deleteUserData } from "../commands/user/datenschutz.js";
import createYesNoInteraction from "./yesNoInteraction.js";
import gLogger from "../service/gLogger.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const statDb = new BunDB("./data/cmd_stats.sqlite");

/**
 * Handle command Interaction events
 *
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @return {Promise<void>}
 */
const handleCommandInteraction = async function(interaction){
    const command = /** @type {import("../service/client.js").default} */ (interaction.client)
        .commands.get(interaction.commandName);

    if (!command){
        Log.warn(`No command matching ${interaction.commandName} was found.`);
        await interaction.reply({
            content: `I kenn des Command ${interaction.commandName} ned =(`,
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    try {
        await statDb.add(interaction.commandName, 1);
        await command.execute(interaction);
    }
    catch (error){
        Log.error("Error during command execution: ", error);
        if (interaction.replied || interaction.deferred){
            await interaction.followUp({
                content: "Do is wos schief gongen =(",
                flags: [MessageFlags.Ephemeral],
            });
        }
        else {
            await interaction.reply({
                content: "Do is wos schief gongen =(",
                flags: [MessageFlags.Ephemeral],
            });
        }
    }
};

/**
 * Handle button events
 *
 * @param {import("discord.js").ButtonInteraction} interaction
 */
const handleButton = async function(interaction){
    if (interaction.customId === "verify"){
        return await startDMVerification(interaction);
    }
    else if (interaction.customId === "birthday_ping_yes" || interaction.customId === "birthday_ping_no"){
        return await handleBirthdayPingButton(interaction);
    }
    else if (interaction.customId === "toggle_birthday_ping"){
        const db = new BunDB("./data/guild_data.sqlite");
        const userId = interaction.user.id;
        const birthdate = await db.get(`user-${userId}.birthdate`);
        const isFullDate = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate);
        if (!isFullDate){
            return await interaction.reply({
                content: "❌ Du kannst den Geburtstagsping nur aktivieren, wenn du ein vollständiges Geburtsdatum hinterlegt hast.",
                flags: [MessageFlags.Ephemeral],
            });
        }
        let birthdayPing = await db.get(`user-${userId}.birthday_ping`);
        birthdayPing = !birthdayPing;
        await db.set(`user-${userId}.birthday_ping`, birthdayPing);
        return await interaction.update({
            content: `🎂 **Geburtstagsping Status:** ${birthdayPing ? "Jo (aktiviert)" : "Na (deaktiviert)"}`,
            components: [ // @ts-ignore
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            custom_id: "toggle_birthday_ping",
                            label: birthdayPing ? "Geburtstagsping deaktivieren" : "Geburtstagsping aktivieren",
                            style: birthdayPing ? 4 : 3, // Danger: 4, Success: 3
                            emoji: "🎂",
                        },
                    ],
                },
            ],
        });
    }
    else if (interaction.customId.startsWith("delete_data_")){
        const userId = interaction.customId.replace("delete_data_", "");

        if (userId !== interaction.user.id){
            return await interaction.reply({
                content: "Du konnst nur deine eigenen Daten löschen.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        let { guild } = interaction;
        let member = null;

        if (!guild){
            const verifiedGuilds = interaction.client.guilds.cache.filter(g => g.members.cache.has(userId));

            if (verifiedGuilds.size === 0){
                return await interaction.reply({
                    content: "Du bist auf kam Server, wo i di findn konn.",
                });
            }

            guild = verifiedGuilds.first() || null;
        }

        member = await guild?.members.fetch(userId).catch(() => null);
        if (!member){
            return await interaction.reply({
                content: "Benutzer ned aufm Server gfunden.",
            });
        }

        const confirmation = await createYesNoInteraction(interaction, {
            promptText: "⚠️ **Achtung!**\n\nBist da sicher, dasst olle deine Daten löschen wüst?\n\n**Des wird:**\n• Alle deine Verifikationsrollen entfernen\n• Dei Geburtsdatum löschen\n• Deine Geburtstag-Ping Einstellung löschen\n• Du musst di neu verifizieren\n\n**Diese Aktion kann ned rückgängig gemacht werden!**",
            yesText: "Jo, alle Daten löschen",
            noText: "Abbrechen",
            yesStyle: ButtonStyle.Danger,
            noStyle: ButtonStyle.Secondary,
            timeout: 30000, // 30 seconds
        });

        if (confirmation === "yes"){
            const success = await deleteUserData(interaction.user, member);

            if (success){
                return await interaction.followUp({
                    content: "✅ Alle deine Daten wurdn erfolgreich glöscht. Du konnst di jederzeit no amol verifizieren.",
                });
            }
            return await interaction.followUp({
                content: "❌ Es is a Fehler beim Löschen deiner Daten auftreten. Bitte versuachs später no amol.",
            });
        }
        else if (confirmation === "no"){
            return await interaction.followUp({
                content: "❌ Datenlöschung abbrochen. Deine Daten bleiben unverändert.",
            });
        }
        else if (confirmation === "timeout"){
            return await interaction.followUp({
                content: "⏰ Zeitüberschreitung. Datenlöschung abbrochen. Deine Daten bleiben unverändert.",
            });
        }
    }

    else if (interaction.customId === "yes" || interaction.customId === "no") return null;

    return Log.warn(`Button interaction received but not handled: ${interaction.customId}`);
};

/**
 * Handle modal submit events
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
const handleModalSubmit = async function(interaction){
    if (interaction.customId === "set_full_birthdate"){
        const fullDate = interaction.fields.getTextInputValue("full_birthdate").trim();

        if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(fullDate)){
            return await interaction.reply({
                content: "❌ Ungültiges Datumsformat. Bitte verwende TT.MM.JJJJ (z.B. 25.01.1999).",
                flags: [MessageFlags.Ephemeral],
            });
        }

        const today = new Date();
        const [day, month, year] = fullDate.split(".");
        const birthDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())){
            age--;
        }
        if (isNaN(birthDate.getTime()) || age < 13 || age > 120){
            return await interaction.reply({
                content: "❌ Das angegebene Datum ist ungültig oder das Alter liegt außerhalb des erlaubten Bereichs (13-120 Jahre).",
                flags: [MessageFlags.Ephemeral],
            });
        }
        // Save and show ping toggle
        const db = new BunDB("./data/guild_data.sqlite");
        await db.set(`user-${interaction.user.id}.birthdate`, fullDate);
        let birthdayPing = await db.get(`user-${interaction.user.id}.birthday_ping`);
        if (typeof birthdayPing !== "boolean") birthdayPing = false;
        const pingStatus = birthdayPing ? "Jo (aktiviert)" : "Na (deaktiviert)";

        if (!interaction.member) return null; // @ts-ignore
        await removeExistingAgeRoles(interaction.member);
        const ageRole = getAgeRole(age); // @ts-ignore
        if (ageRole) await interaction.member.roles.add(ageRole);

        await gLogger(
            interaction,
            "🔷┃User Nachtrag - Sucess",
            `User ${interaction.user} hat sein vollständiges Geburtsdatum nachgetragen: ${fullDate}.\nPing Status: ${pingStatus}\nAlter: ${age}`,
        );
        Log.done(`User ${interaction.user.username} (${interaction.user.id}) hat sein vollständiges Geburtsdatum nachgetragen: ${fullDate}. Ping Status: ${pingStatus}`);

        return await interaction.reply({
            content: `✅ Dein vollständiges Geburtsdatum wurde gespeichert. **Achtung:** Du kannst dieses Datum nur ändern, indem du all deine Daten löschst!\n\n🎂 **Geburtstagsping Status:** ${pingStatus}`,
            components: [ // @ts-ignore
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            custom_id: "toggle_birthday_ping",
                            label: birthdayPing ? "Geburtstagsping deaktivieren" : "Geburtstagsping aktivieren",
                            style: birthdayPing ? 4 : 3,
                            emoji: "🎂",
                        },
                    ],
                },
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }
    return Log.warn(`Modal submit interaction received but not handled: ${interaction.customId}`);
};

/**
 * Handle string select menu events
 *
 * @param {import("discord.js").StringSelectMenuInteraction} interaction
 */
const handleStringSelectMenu = async function(interaction){
    if (interaction.customId === "gender_selection"){
        await handleGenderSelection(interaction);
    }
};

/**
 * Handle interactionCreate event
 *
 * @param {import("discord.js").Interaction} interaction
 * @return {Promise<void>}
 */
const interactionCreateHandler = async function(interaction){
    if (interaction.isChatInputCommand()) await handleCommandInteraction(interaction);
    if (interaction.isModalSubmit()) await handleModalSubmit(interaction);
    if (interaction.isButton()) await handleButton(interaction);
    if (interaction.isStringSelectMenu()) await handleStringSelectMenu(interaction);
};

export default interactionCreateHandler;
