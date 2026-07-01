import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";
import { consumeAiReply } from "../ai/aiRateLimit.js";
import { PythonAIWorker } from "../ai/getAiReply.js";
import { MessageLearner } from "../ai/MessageLearner.js";
import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export const aiWorker = new PythonAIWorker();

const brain = new MessageLearner();
await brain.init();

/**
 * Get the bot name for mentions, try the nickname of the bot in the guild first, then display name
 *
 * @param {import("discord.js").Message} message
 */
const getBotName = message => {
    if (message.guild){
        const member = message.guild.members.cache.get(message.client.user.id);
        return member?.nickname || message.client.user.displayName;
    }
    return message.client.user.displayName;
};

/**
 * Clean message content by removing mentions and trimming whitespace
 *
 * @param {import("discord.js").Message} message
 */
const cleanMsg = message => message.cleanContent.replace(/<a?(:[a-zA-Z0-9_]+:)[0-9]+>/g, "$1")
    .replace(`<@${message.client.user.id}>`, "")
    .replace(`@${getBotName(message)} `, "")
    .trim();

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

        if (config.ai_included_channels.includes(message.channelId)){
            brain.learn({
                id: message.id,
                content: message.content,
                channelId: message.channelId, // @ts-ignore
                authorId: message.author.id, // @ts-ignore
                replyToId: message.reference?.messageId ?? null,
                createdTimestamp: message.createdTimestamp,
            });
        }

        // @ts-ignore
        if (message.mentions.has(message.client.user)){
            if (message.content.trim() === `<@!${message.client.user?.id}>`) return;

            const botChannelId = config.channels.bot;
            // @ts-ignore
            const isOwner = config.discord.bot_owner_ids.includes(message.author.id);
            const isLimited = !isOwner && !!botChannelId && message.channelId !== botChannelId;

            /** @type {"allow" | "redirect"} */
            let decision = "allow";
            if (isLimited){
                const d = consumeAiReply(message.author.id);
                if (d === "ignore") return;
                decision = d;
            }

            /** @type {import("discord.js").TextBasedChannel} */
            let replyChannel = message.channel;
            if (decision === "redirect"){
                await message.reply({
                    content: `Lass im <#${botChannelId}> Channel weiterschreiben`,
                    allowedMentions: { parse: [] },
                }).catch(() => {});

                const fetched = await message.guild?.channels.fetch(botChannelId).catch(() => null);
                if (!fetched || !fetched.isTextBased()){
                    Log.error(`[AIWorker] bot_channel ${botChannelId} not found or not text-based.`);
                    return;
                }
                replyChannel = fetched;
            }

            if ("sendTyping" in replyChannel) replyChannel.sendTyping();
            const query = cleanMsg(message);

            // Previous human messages, most-recent first, for weighted
            // multi-query retrieval in the brain (context[0] = latest).
            const contexts = [];

            try {
                const prevMessages = await message.channel.messages.fetch({ limit: 4, before: message.id });
                if (prevMessages.size > 0){
                    for (const [, msg] of prevMessages){
                        if (!msg.author.bot && contexts.length < 3){
                            const content = cleanMsg(msg);
                            if (content && content.length > 0) contexts.push(content);
                        }
                    }
                }
            }
            catch (e){
                Log.error("[AIWorker] Could not fetch previous messages for context: ", e);
            }

            try {
                const reply = await aiWorker.infer(query, contexts);

                if (decision === "redirect" && "send" in replyChannel){
                    await replyChannel.send({
                        content: `<@${message.author.id}> ${reply}`,
                        allowedMentions: { users: [message.author.id] },
                    });
                }
                else {
                    await message.reply(reply);
                }
            }
            catch (err){
                Log.error("[AIWorker] Inference error:", err);
                await message.reply("Fehler: Bot moch grod ned so beep boop wie er soll... Frag Shadow warum er nix kann");
            }
        }
    }
};

export default messageCreateHandler;
