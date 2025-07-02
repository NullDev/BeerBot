import { BunDB } from "bun.db";
import { SlashCommandBuilder, InteractionContextType, MessageFlags, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "../../../config/config.js";
import Log from "../../util/log.js";
import { calculateAge } from "../../service/dmVerification/utils.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Debug birthday system - shows current state and configuration.")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        try {
            const today = new Date();
            const todayString = today.toDateString();
            const todayKey = `birthday_check_${todayString}`;

            const userId = interaction.user.id;
            const birthdate = await db.get(`user-${userId}.birthdate`);
            const birthdayPing = await db.get(`user-${userId}.birthday_ping`);
            const verified = await db.get(`user-${userId}.verified`);
            const alreadyProcessed = await db.get(todayKey);

            let birthDate = null;
            let isToday = false;
            let age = null;

            if (birthdate){
                if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthdate)){
                    birthDate = new Date(birthdate.split(".").reverse().join("-"));
                    isToday = today.getDate() === birthDate.getDate() && today.getMonth() === birthDate.getMonth();
                    age = calculateAge(birthdate);
                }
            }

            const allData = await db.all();
            const userKeys = allData
                .filter(item => item.id.startsWith("user-") && item.id.includes(".birthdate"))
                .map(item => item.id);

            const debugEmbed = new EmbedBuilder()
                .setTitle("🔍┃Birthday Debug Info")
                .setColor(13111086)
                .addFields(
                    { name: "Current Date", value: today.toLocaleDateString("de-DE"), inline: true },
                    { name: "Today String", value: todayString, inline: true },
                    { name: "Already Processed", value: alreadyProcessed ? "Yes" : "No", inline: true },
                    { name: "Your Birthday", value: birthdate || "Not set", inline: true },
                    { name: "Birthday Ping", value: birthdayPing ? "Enabled" : "Disabled", inline: true },
                    { name: "Verified", value: verified ? "Yes" : "No", inline: true },
                    { name: "Is Today", value: isToday ? "Yes" : "No", inline: true },
                    { name: "Age", value: age ? age.toString() : "N/A", inline: true },
                    { name: "Birthday Role ID", value: config.roles.birthday || "Not configured", inline: true },
                    { name: "General Channel ID", value: config.channels.general || "Not configured", inline: true },
                    { name: "Total Users with Birthdays", value: userKeys.length.toString(), inline: true },
                    { name: "Your User Key", value: `user-${userId}.birthdate`, inline: true },
                    { name: "Found in Query", value: userKeys.includes(`user-${userId}.birthdate`) ? "Yes" : "No", inline: true },
                )
                .setFooter({
                    text: "Use this to debug birthday issues",
                });

            await interaction.reply({
                embeds: [debugEmbed],
                flags: [MessageFlags.Ephemeral],
            });
        }
        catch (error){
            Log.error("Error in birthday-debug command:", error);
            await interaction.reply({
                content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
                flags: [MessageFlags.Ephemeral],
            });
        }
    },
};
