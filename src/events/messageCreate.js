import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";
import { OrganicMarkov } from "../ai/Markov.js";
import { config } from "../../config/config.js";
import seed from "../ai/seed.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const brain = new OrganicMarkov({ order: 2 });
await brain.init();

/**
 * Handle messageCreate event
 *
 * @param {import("discord.js").Message} message
 * @return {Promise<void>}
 */
const messageCreateHandler = async function(message){
    // Only handle DM messages for verification
    if (message.channel.type === ChannelType.DM){
        await handleDMVerification(message);
    }

    else if (message.channel.type === ChannelType.GuildText && !message.author.bot){
        await jokes(message);

        const channelId = message.channel.id; // @ts-ignore
        if (config.discord.bot_owner_ids.includes(message.author.id) && message.content?.trim().startsWith("!!MKDEV ")){
            const query = message.content.trim().substring(8).trim();

            const reply = await brain.generateSentence(query, {
                maxLen: 140,
                similarityThreshold: 0.22,
                temperature: 0.55,
            });

            if (reply) await message.reply({ content: reply.slice(0, 1800) });
        }
        // @ts-ignore
        if (config.discord.bot_owner_ids.includes(message.author.id) && message.content?.trim() === "!!SEEDDB"){
            await brain.seedDatabase(seed);
            await message.reply({ content: "Seeded database with initial conversational pairs.", options: { ephemeral: true } });
        }
        else if (config.ai_included_channels.includes(channelId)){
            brain.learn({
                id: message.id,
                content: message.content ?? "", // @ts-ignore
                authorId: message.author.id,
                replyToId: message.reference?.messageId ?? null,
                timestamp: message.createdTimestamp,
            });
        }
    }
};

export default messageCreateHandler;
