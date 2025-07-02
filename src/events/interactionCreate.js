import { BunDB } from "bun.db";
import { MessageFlags } from "discord.js";
import { startDMVerification } from "../service/dmVerification/dmVerification.js";
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
    else if (interaction.customId.startsWith("delete_data_")){
        const userId = interaction.customId.replace("delete_data_", "");

        // Only allow users to delete their own data
        if (userId !== interaction.user.id){
            await interaction.reply({
                content: "Du kannst nur deine eigenen Daten löschen.",
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        // Find the guild where the user is a member
        let {guild} = interaction;
        let member = null;

        if (!guild){
            // If no guild in interaction (DM), find the guild where user is verified
            const verifiedGuilds = interaction.client.guilds.cache.filter(g => g.members.cache.has(userId));

            if (verifiedGuilds.size === 0){
                await interaction.reply({
                    content: "Du bist auf keinem Server, wo ich dich finden kann.",
                });
                return;
            }

            // Use the first guild where the user is a member
            guild = verifiedGuilds.first();
        }

        member = await guild.members.fetch(userId).catch(() => null);
        if (!member){
            await interaction.reply({
                content: "Benutzer nicht auf dem Server gefunden.",
            });
            return;
        }

        // Show confirmation dialog
        const confirmation = await createYesNoInteraction(interaction, {
            promptText: "⚠️ **Achtung!**\n\nBist du sicher, dass du alle deine Daten löschen möchtest?\n\n**Das wird:**\n• Alle deine Verifikationsrollen entfernen\n• Dein Geburtsdatum löschen\n• Deine Geburtstag-Ping Einstellung löschen\n• Du musst dich neu verifizieren\n\n**Diese Aktion kann nicht rückgängig gemacht werden!**",
            yesText: "Ja, alle Daten löschen",
            noText: "Abbrechen",
            yesStyle: "Danger",
            noStyle: "Secondary",
            timeout: 30000, // 30 seconds
        });

        if (confirmation === "yes"){
            const success = await deleteUserData(interaction.user, member, interaction.client);

            if (success){
                await interaction.followUp({
                    content: "✅ Alle deine Daten wurden erfolgreich gelöscht. Du kannst dich jederzeit neu verifizieren.",
                });
            }
            else {
                await interaction.followUp({
                    content: "❌ Es ist ein Fehler beim Löschen deiner Daten aufgetreten. Bitte versuche es später erneut.",
                });
            }
        }
        else if (confirmation === "no"){
            await interaction.followUp({
                content: "❌ Datenlöschung abgebrochen. Deine Daten bleiben unverändert.",
            });
        }
        else if (confirmation === "timeout"){
            await interaction.followUp({
                content: "⏰ Zeitüberschreitung. Datenlöschung abgebrochen. Deine Daten bleiben unverändert.",
            });
        }
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
};

export default interactionCreateHandler;
