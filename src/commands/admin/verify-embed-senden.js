import { BunDB } from "bun.db";
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    InteractionContextType,
    EmbedBuilder,
} from "discord.js";
import defaults from "../../util/defaults.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Sendet de Verifizierungsnachricht in an angegebene Channel (LÖSCHT DE ALTE NOCHRICHT A).")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption((option) =>
            option.setName("channel")
                .setDescription("Da Channel wos hingsendet werden sui")
                .setRequired(true)),

    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const channel = interaction.options.get("channel");
        if (!channel){
            return await interaction.editReply({
                content: "Du host den Channel vergessn.",
            });
        }

        let val = String(channel.value)?.match(/^<#(\d+)>$/)?.[1];

        if (!val) val = (await interaction.guild?.channels.fetch().catch(() => null))?.find(ch => ch?.name === channel.value && ch?.type === ChannelType.GuildText)?.id;
        if (!val){
            return await interaction.editReply({
                content: "Den Channel konn i ned finden.",
            });
        }

        const ch = /** @type {import("discord.js").TextChannel} */ (await interaction.guild?.channels.fetch(val).catch(() => null));
        if (!ch){
            return await interaction.editReply({
                content: "Den Channel konn i ned finden.",
            });
        }

        const embed = new EmbedBuilder()
            .setColor(defaults.embed_color)
            .setTitle("🔷┃Verifikation")
            .setDescription("### Servas!\n🍺┃Willkommen am **Bundes Beer** Server!\n🛡️┃Um verifiziert zu werdn,\n🌐┃klick bittschen auf den Button untn und fü des Formular aus.\n\n💎┃Vü spaß am Serva")
            .setImage("attachment://upsell.jpg")
            .setFooter({
                text: "Wonnst ane Frogn oda Probleme host, gib am Staff-Member bescheid.",
                iconURL: "attachment://icon.png",
            });

        const message = await ch.send({
            files: [
                {
                    attachment: "assets/banner-crop.jpg",
                    name: "banner-crop.jpg",
                },
                {
                    attachment: "assets/upsell.jpg",
                    name: "upsell.jpg",
                },
                {
                    attachment: "assets/icon.png",
                    name: "icon.png",
                },
            ],
            embeds: [embed],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 3,
                            label: "Loss mi eini!",
                            custom_id: "verify",
                        },
                    ],
                },
            ],
        });

        const oldMessage = await db.get(`guild-${interaction.guildId}.verify_message`);
        if (oldMessage){
            await ch.messages.delete(oldMessage).catch(() => null);
        }

        await db.set(`guild-${interaction.guildId}.verify_message`, message.id);

        return await interaction.editReply({
            content: "Nochricht wurd an <#" + val + "> gsendet.",
        });
    },
};
