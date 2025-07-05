import { BunDB } from "bun.db";
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    InteractionContextType,
} from "discord.js";
import { config } from "../../../config/config.js";
import Log from "../../util/log.js";
import gLogger from "../../service/gLogger.js";
import { removeExistingAgeRoles } from "../../service/dmVerification/utils.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Resetet einen Benutzer (entfernt Verifikation und Rollen).")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption((option) =>
            option.setName("user")
                .setDescription("Der Benutzer der zurückgesetzt werden soll")
                .setRequired(true)),

    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userOption = interaction.options.get("user");
        if (!userOption){
            return await interaction.editReply({
                content: "Du host den Benutzer vergessn.",
            });
        }

        const targetUser = userOption.user;
        if (!targetUser){
            return await interaction.editReply({
                content: "Den Benutzer konn i ned aufm Server findn.",
            });
        }

        const targetMember = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember){
            return await interaction.editReply({
                content: "Den Benutzer konn i ned aufm Server findn.",
            });
        }

        // Check if user is verified
        const isVerified = await db.get(`user-${targetUser.id}.verified`);
        if (!isVerified){
            return await interaction.editReply({
                content: "Der Benutzer is ned verifiziert.",
            });
        }

        try {
            if (config.roles.verified && targetMember.roles.cache.has(config.roles.verified)){
                await targetMember.roles.remove(config.roles.verified);
            }

            await removeExistingAgeRoles(targetMember);

            if (config.roles.unverified && !targetMember.roles.cache.has(config.roles.unverified)){
                await targetMember.roles.add(config.roles.unverified);
            }

            await db.delete(`user-${targetUser.id}.verified`);
            await db.delete(`user-${targetUser.id}.birthdate`);
            await db.delete(`user-${targetUser.id}.birthday_ping`);
            await db.delete(`user-${targetUser.id}.gender`);
            await db.delete(`user-${targetUser.id}.verification_state`);
            await db.delete(`user-${targetUser.id}.verification_guild`);
            await db.delete(`user-${targetUser.id}.verification_timeout`);
            await db.delete(`user-${targetUser.id}.temp_birthdate`);
            await db.delete(`user-${targetUser.id}.temp_is_full_date`);

            Log.done(`User ${targetUser.displayName} has been reset by ${interaction.user.displayName}`);

            await gLogger( // @ts-ignore
                interaction,
                "🔷┃User Reset - Erfolg",
                `Benutzer ${targetUser} wurde von ${interaction.user} zurückgesetzt.\nAlle Verifikationsdaten und Rollen wurden entfernt.`,
            );

            return await interaction.editReply({
                content: `Benutzer ${targetUser} wurd erfolgreich zurückgsetzt. Alle Verifikationsdaten und Rollen wurdn entfernt.`,
            });
        }
        catch (error){
            Log.error(`Error during user reset for ${targetUser.displayName}:`, error);

            await gLogger( // @ts-ignore
                interaction,
                "🔷┃User Reset - Error",
                `Fehler beim Zurücksetzen von ${targetUser} durch ${interaction.user}:\n${error.message}`,
                "Red",
            );

            return await interaction.editReply({
                content: "Es is a Fehler beim Zurücksetzen aufgetreten. Bitte versuachs später no amol.",
            });
        }
    },
};
