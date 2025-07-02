import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../../../config/config.js";
import Log from "../../util/log.js";
import gLogger from "../../service/gLogger.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

/**
 * Remove existing age roles from member
 *
 * @param {import("discord.js").GuildMember} member
 * @return {Promise<void>}
 */
const removeExistingAgeRoles = async function(member){
    const ageRoleIds = Object.values(config.roles.ages);
    for (const roleId of ageRoleIds){
        if (roleId && member.roles.cache.has(roleId)){
            await member.roles.remove(roleId).catch(() => null);
        }
    }
};

/**
 * Delete all user data and remove roles
 *
 * @param {import("discord.js").User} user
 * @param {import("discord.js").GuildMember} member
 * @param {import("discord.js").Client} client
 * @return {Promise<void>}
 */
const deleteUserData = async function(user, member, client){
    const userId = user.id;

    try {
        // Remove verified role
        if (config.roles.verified && member.roles.cache.has(config.roles.verified)){
            await member.roles.remove(config.roles.verified);
        }

        // Remove all age roles
        await removeExistingAgeRoles(member);

        // Delete all user data from database
        await db.delete(`user-${userId}.verified`);
        await db.delete(`user-${userId}.birthdate`);
        await db.delete(`user-${userId}.birthday_ping`);
        await db.delete(`user-${userId}.verification_state`);
        await db.delete(`user-${userId}.verification_guild`);
        await db.delete(`user-${userId}.verification_timeout`);
        await db.delete(`user-${userId}.temp_birthdate`);
        await db.delete(`user-${userId}.temp_is_full_date`);

        // Log success
        Log.done(`User ${user.displayName} has deleted their own data`);

        // Log to guild
        await gLogger(
            { user, guild: member.guild, client },
            "🔷┃Data Deletion - User Request",
            `Benutzer ${user} hat seine Daten selbst gelöscht.\nAlle Verifikationsdaten und Rollen wurden entfernt.`,
        );

        return true;
    }
    catch (error){
        Log.error(`Error during user data deletion for ${user.displayName}:`, error);

        await gLogger(
            { user, guild: member.guild, client },
            "🔷┃Data Deletion - Error",
            `Fehler beim Löschen der Daten von ${user}:\n${error.message}`,
            "Red",
        );

        return false;
    }
};

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Infos zum Datenschutz und Datenlöschung.")
        .setContexts([InteractionContextType.Guild, InteractionContextType.DM]),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        try {
            // Check if user is verified
            const isVerified = await db.get(`user-${interaction.user.id}.verified`);

            const embed = new EmbedBuilder()
                .setTitle("🔒┃Datenschutz & Datenlöschung")
                .setDescription("### Deine Daten bei uns\n\n**Was wir speichern:**\n• Dein Geburtsdatum (für Altersverifikation)\n• Deine Geburtstag-Ping Einstellung\n• Dein Verifikationsstatus\n\n**Automatische Löschung:**\n• Alle deine Daten werden automatisch gelöscht, wenn du den Server verlässt\n• Keine Daten werden an Dritte weitergegeben\n\n**Manuelle Löschung:**\n• Du kannst deine Daten jederzeit mit dem Button unten löschen\n• Dies entfernt auch alle Verifikationsrollen")
                .setColor(13111086)
                .setFooter({
                    text: "Deine Privatsphäre ist uns wichtig!",
                });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`delete_data_${interaction.user.id}`)
                        .setLabel("Alle Daten löschen")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🗑️"),
                );

            await interaction.user.send({
                embeds: [embed],
                components: isVerified ? [row] : [],
                files: [
                    {
                        attachment: "assets/banner-crop.jpg",
                        name: "banner-crop.jpg",
                    },
                ],
            });

            await interaction.reply({
                content: "Schau in deine DMs für Datenschutz-Informationen!",
                flags: [MessageFlags.Ephemeral],
            });
        }
        catch (error){
            Log.error(`Failed to send privacy info to user ${interaction.user.displayName}:`, error);
            await interaction.reply({
                content: "Ich konnte dir keine DM senden. Bitte stelle sicher, dass du DMs von Servermitgliedern akzeptierst.",
                flags: [MessageFlags.Ephemeral],
            });
        }
    },
};

// Export for button handler
export { deleteUserData };
