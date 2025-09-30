import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";
import { OrganicMarkov } from "../ai/Markov.js";
import { PythonAIWorker } from "../ai/getAiReply.js";
import Log from "../util/log.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const brain = new OrganicMarkov({ order: 2 });
await brain.init();

const aiWorker = new PythonAIWorker();

/**
 * Clean message content by removing mentions and trimming whitespace
 *
 * @param {import("discord.js").Message} message
 */
const cleanMsg = message => message.cleanContent.replace(/<a?(:[a-zA-Z0-9_]+:)[0-9]+>/g, "$1")
    .replace(`<@${message.client.user.id}>`, "").trim();

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
        if (config.discord.bot_owner_ids.includes(message.author.id) && message.mentions.has(message.client.user)){
            if (message.content.trim() === `<@!${message.client.user?.id}>`) return;
            const query = cleanMsg(message);
            message.channel.sendTyping();
            try {
                const reply = await aiWorker.infer(query);
                await message.reply(reply);
            }
            catch (err){
                Log.error("[AIWorker] Inference error:", err);
                await message.reply("Fehler: Bot moch grod ned so beep boop wie er soll... Frag Shadow warum er nix kann");
            }
        }
        else if (config.ai_included_channels.includes(channelId)){
            brain.learn({
                id: message.id,
                content: cleanMsg(message) || "", // @ts-ignore
                authorId: message.author.id,
                replyToId: message.reference?.messageId ?? null,
                timestamp: message.createdTimestamp,
            });
        }
    }
};

export default messageCreateHandler;
