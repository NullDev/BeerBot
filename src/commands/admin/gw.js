import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    InteractionContextType,
} from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Ghostwriter")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName("text")
                .setDescription("Der Text den Bierli senden soll")
                .setRequired(true))
        .addUserOption((option) =>
            option.setName("user")
                .setDescription("Der Benutzer den Bierli impersonieren soll")
                .setRequired(false))
        .addStringOption((option) =>
            option.setName("replyid")
                .setDescription("Die ID der Nachricht auf die geantwortet werden soll")
                .setRequired(false)),

    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const text = interaction.options.getString("text", true);
        const user = interaction.options.getUser("user");
        const replyId = interaction.options.getString("replyid");

        try {
            const { channel } = interaction;
            if (!channel || !channel.isTextBased()){
                await interaction.editReply("❌ Konnte den Channel nicht finden.");
                return;
            }

            if (user){
                const member = await channel.guild.members.fetch(user.id).catch(() => null);
                if (!member){
                    await interaction.editReply("❌ Konnte den Benutzer nicht finden.");
                    return;
                }

                const name = member.nickname || member.displayName || user.username;
                const avatar = (user.displayAvatarURL() || "https://cdn.discordapp.com/embed/avatars/0.png").replace(".gif", ".png");

                const webhook = await channel.createWebhook({
                    name,
                    avatar,
                });

                await webhook.send({
                    content: text,
                    username: name,
                    avatarURL: avatar,
                }).catch(() => null);

                await webhook.delete().catch(() => null);
                await interaction.editReply("✅ Nachricht als Impersonation gesendet.");
            }
            else {
                if (replyId){
                    const msg = await channel.messages.fetch(replyId).catch(() => null);
                    if (msg){
                        await msg.reply(text).catch(() => null);
                    }
                    else {
                        await channel.send(text).catch(() => null);
                    }
                }
                else {
                    await channel.send(text).catch(() => null);
                }
                await interaction.editReply("✅ Nachricht gesendet.");
            }
        }
        catch (err){
            console.error(err);
            await interaction.editReply("❌ Fehler beim Senden.");
        }
    },
};
