import { SlashCommandBuilder, InteractionContextType, MessageFlags } from "discord.js";
import { config } from "../../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zagt die Olterverteilung hier am server an.")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const { guild } = interaction;
        if (!guild){
            const errorContent = "❌ Konn ned auf den Server zugreifen.";
            if (interaction.deferred){
                return await interaction.editReply({ content: errorContent });
            }
            return await interaction.reply({
                content: errorContent,
                flags: [MessageFlags.Ephemeral],
            });
        }

        const ageRoles = config.roles.ages;
        const roleStats = [];

        for (const [ageRange, roleId] of Object.entries(ageRoles)){
            if (!roleId) continue;

            const role = await guild.roles.fetch(roleId);
            if (!role) continue;

            const memberCount = role.members.size;
            roleStats.push({
                ageRange,
                roleId,
                memberCount,
                roleName: role.name,
            });
        }

        roleStats.sort((a, b) => b.memberCount - a.memberCount);

        const totalMembersWithAgeRoles = roleStats.reduce((sum, stat) => sum + stat.memberCount, 0);

        let responseContent = "**📊 Altersverteilung aufm BundesBeer Server:**\n\n";

        if (roleStats.length === 0){
            responseContent += "❌ Keine Altersrollen gefunden oder konfiguriert.";
        }
        else {
            for (const stat of roleStats){
                const percentage = totalMembersWithAgeRoles > 0
                    ? ((stat.memberCount / totalMembersWithAgeRoles) * 100).toFixed(1)
                    : "0.0";

                const ageRangeDisplay = stat.ageRange.replace("_", "-").replace("+", "+");
                responseContent += `**${ageRangeDisplay} Jahre:** ${stat.memberCount} Mitglied${stat.memberCount === 1 ? "" : "er"} (${percentage}%)\n`;
            }
        }

        responseContent += `\n**Summe:** ${totalMembersWithAgeRoles} Mitglieder\n`;

        if (interaction.deferred){
            return await interaction.editReply({
                content: responseContent,
            });
        }
        return await interaction.reply({
            content: responseContent,
            flags: [MessageFlags.Ephemeral],
        });
    },
};
