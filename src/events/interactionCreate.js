import { BunDB } from "bun.db";
import { MessageFlags } from "discord.js";
import { startDMVerification, handleBirthdayPingButton, handleGenderSelection } from "../service/dmVerification/dmVerification.js";
import { deleteUserData } from "../commands/user/datenschutz.js";
import createYesNoInteraction from "./yesNoInteraction.js";
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
        await startDMVerification(interaction);
    }
    else if (interaction.customId === "birthday_ping_yes" || interaction.customId === "birthday_ping_no"){
        await handleBirthdayPingButton(interaction);
    }
    else if (interaction.customId.startsWith("delete_data_")){
        const userId = interaction.customId.replace("delete_data_", "");

        if (userId !== interaction.user.id){
            await interaction.reply({
                content: "Du konnst nur deine eigenen Daten löschen.",
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        let {guild} = interaction;
        let member = null;

        if (!guild){
            const verifiedGuilds = interaction.client.guilds.cache.filter(g => g.members.cache.has(userId));

            if (verifiedGuilds.size === 0){
                await interaction.reply({
                    content: "Du bist auf kam Server, wo i di findn konn.",
                });
                return;
            }

            guild = verifiedGuilds.first();
        }

        member = await guild.members.fetch(userId).catch(() => null);
        if (!member){
            await interaction.reply({
                content: "Benutzer ned aufm Server gfunden.",
            });
            return;
        }

        const confirmation = await createYesNoInteraction(interaction, {
            promptText: "⚠️ **Achtung!**\n\nBist da sicher, dasst olle deine Daten löschen wüst?\n\n**Des wird:**\n• Alle deine Verifikationsrollen entfernen\n• Dei Geburtsdatum löschen\n• Deine Geburtstag-Ping Einstellung löschen\n• Du musst di neu verifizieren\n\n**Diese Aktion kann ned rückgängig gemacht werden!**",
            yesText: "Jo, alle Daten löschen",
            noText: "Abbrechen",
            yesStyle: "Danger",
            noStyle: "Secondary",
            timeout: 30000, // 30 seconds
        });

        if (confirmation === "yes"){
            const success = await deleteUserData(interaction.user, member, interaction.client);

            if (success){
                await interaction.followUp({
                    content: "✅ Alle deine Daten wurdn erfolgreich glöscht. Du konnst di jederzeit no amol verifizieren.",
                });
            }
            else {
                await interaction.followUp({
                    content: "❌ Es is a Fehler beim Löschen deiner Daten auftreten. Bitte versuachs später no amol.",
                });
            }
        }
        else if (confirmation === "no"){
            await interaction.followUp({
                content: "❌ Datenlöschung abbrochen. Deine Daten bleiben unverändert.",
            });
        }
        else if (confirmation === "timeout"){
            await interaction.followUp({
                content: "⏰ Zeitüberschreitung. Datenlöschung abbrochen. Deine Daten bleiben unverändert.",
            });
        }
    }
};

/**
 * Handle modal submit events
 *
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
const handleModalSubmit = async function(interaction){
    // Currently no modal submissions are handled
    Log.warn(`Modal submit interaction received but not handled: ${interaction.customId}`);
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
