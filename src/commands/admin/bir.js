import { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Bir")
        .setContexts([InteractionContextType.Guild])
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    /**
     * @param {import("discord.js").CommandInteraction} interaction
     */
    async execute(interaction){
        if (!interaction.deferred && !interaction.replied){
            await interaction.deferReply();
        }

        const txt = `Unser Bier, das im Kühlschrank steht,
geheiligt werde Dein Rausch.
Dein Kater komme,
Dein Wille geschehe,
wie im Club, so im Garten.

Unser tägliches Bier gib uns heute,
und vergib uns unseren Vollrausch,
wie auch wir vergeben den Durstigen.
Und führe uns nicht zur Vernunft,
sondern erlöse uns vom Nüchternsein.

Denn Dein ist der Trichter
und der Kater
und der Rausch
in Ewigkeit.

Prost. 🍻`;

        if (interaction.deferred){
            return await interaction.editReply({
                content: txt,
            });
        }
        return await interaction.reply({
            content: txt,
        });
    },
};
