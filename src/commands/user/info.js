import os from "node:os";
import { SlashCommandBuilder, InteractionContextType } from "discord.js";
import defaults from "../../util/defaults.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zagt Informationen üba den Bot")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        const count = interaction.guild?.memberCount || "N/A";
        const boosts = interaction.guild?.premiumSubscriptionCount || "N/A";
        const RamInUseMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
        const RamTotalGB = Math.floor(os.totalmem() / 1024 / 1024 / 1024);

        const created = interaction.guild?.createdAt.toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }) || "N/A";

        const guildOwner = interaction.guild?.ownerId;
        let owner = "N/A";
        if (guildOwner) owner = (await interaction.client.users.fetch(guildOwner)).tag;

        const isBotVerified = interaction.client.user?.flags?.has("VerifiedBot") || false;

        const botAvatar = interaction.client.user?.displayAvatarURL({ extension: "png" })
            || "https://cdn.discordapp.com/embed/avatars/0.png";

        const embed = {
            title: "Bot Info",
            description: "Wächern fürn BundesBeer Discord Serva :beer:",
            color: defaults.embed_color,
            thumbnail: {
                url: botAvatar,
            },
            fields: [
                {
                    name: "Mocher :computer:",
                    value: "`shadow` / `nullping` / [NullDev](https://github.com/NullDev)",
                    inline: true,
                },
                {
                    name: "Quellkod :scroll:",
                    value: "GitHub: [NullDev/BeerBot](https://github.com/NullDev/BeerBot)",
                    inline: true,
                },
                { name: "\u200b", value: "\u200b", inline: true },
                {
                    name: "Programmiersproch :wrench:",
                    value: `NodeJS/Bun ${process.version}`,
                    inline: true,
                },
                {
                    name: "Server OS :pager:",
                    value: `${os.type()} ${os.release()} ${os.arch()}`,
                    inline: true,
                },
                { name: "\u200b", value: "\u200b", inline: true },
                {
                    name: "Meta zeig :bar_chart:",
                    value: `PID: \`${process.pid}\`\nUptime: \`${
                        process.uptime().toFixed(4)
                    }s\`\nSystem CPU Time: \`${process.cpuUsage().system}\`\nUser CPU Time: \`${process.cpuUsage().system}\`\nRam Usage: \`${RamInUseMB}MB / ${RamTotalGB}GB\`\nBot Verified: \`${isBotVerified}\``,
                    inline: true,
                },
                {
                    name: "Discord Serva :clipboard:",
                    value: `Nutzeronzohl: \`${count}\`\nBoosts: \`${boosts}\`\nErstöllt: \`${created}\`\nOwner: \`${owner}\``,
                    inline: true,
                },
                { name: "\u200b", value: "\u200b", inline: true },
            ],
        };

        return await interaction.reply({ embeds: [embed] });
    },
};
