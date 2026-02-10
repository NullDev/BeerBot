import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";
import { MessageLearner } from "../ai/MessageLearner.js";
import { PythonAIWorker } from "../ai/getAiReply.js";
import Log from "../util/log.js";
import { config } from "../../config/config.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const brain = new MessageLearner();
await brain.init();

const aiWorker = new PythonAIWorker();

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

        const channelId = message.channel.id; // @ts-ignore
        if (message.mentions.has(message.client.user)){
            return;
            
            if (message.content.trim() === `<@!${message.client.user?.id}>`) return;
            message.channel.sendTyping();
            let query = cleanMsg(message);

            const debugMode = query.includes("[DEBUG]");
            if (debugMode){
                query = query.replace(/\[DEBUG\]/gi, "").trim();
            }

            try {
                const prevMessages = await message.channel.messages.fetch({ limit: 4, before: message.id });
                if (prevMessages.size > 0){
                    const contexts = [];
                    // Get up to 3 non-bot messages
                    for (const [, msg] of prevMessages){
                        if (!msg.author.bot && contexts.length < 3){
                            const content = cleanMsg(msg);
                            if (content && content.length > 0){
                                contexts.push(content);
                            }
                        }
                    }

                    if (contexts.length > 0){
                        // Reverse to get chronological order, join with |
                        query = `[PREV: ${contexts.reverse().join(" | ")}] ${query}`;
                    }
                }
            }
            catch (e){
                Log.error("[AIWorker] Could not fetch previous message for context: ", e);
            }

            try {
                const reply = await aiWorker.infer(query, debugMode);

                if (debugMode && typeof reply === "object"){
                    const { EmbedBuilder } = await import("discord.js");
                    const embeds = [];

                    // Sort candidates by score
                    const sortedCandidates = reply.debug.candidates
                        .map((cand, idx) => ({ ...cand, originalIndex: idx }))
                        .sort((a, b) => b.score - a.score);

                    const selectedIndex = sortedCandidates.findIndex(c => c.text === reply.text);

                    const overviewEmbed = new EmbedBuilder()
                        .setTitle("🔍 AI Debug")
                        .setDescription("**Type:** LSTM Seq2Seq + Luong Attention + KenLM Reranker")
                        .addFields(
                            { name: "Epochs", value: "`50`", inline: true },
                            { name: "Loss", value: "`1.4860`", inline: true },
                            { name: "Vocab Size", value: "`8000`", inline: true },
                            { name: "Embedding Size", value: "`256`", inline: true },
                            { name: "Hidden Size", value: "`256`", inline: true },
                            { name: "Layers", value: "`2`", inline: true },
                        )
                        .setColor(0x5865F2);
                    embeds.push(overviewEmbed);

                    sortedCandidates.slice(0, 3).forEach((candidate, index) => {
                        const isSelected = index === selectedIndex;
                        const {breakdown} = candidate;
                        const {params} = candidate;

                        const candidateEmbed = new EmbedBuilder()
                            .setTitle(`Candidate #${index + 1}${isSelected ? " - CHOSEN REPLY ⭐" : ""}`)
                            .setColor(isSelected ? 0x57F287 : 0x3B3D42)
                            .addFields(
                                { name: "Text", value: `"${candidate.text.substring(0, 200)}${candidate.text.length > 200 ? "..." : ""}"`, inline: false },
                                { name: "Final Score", value: `**\`${breakdown.total.toFixed(2)}\`**`, inline: true },
                                { name: "Parroted", value: candidate.parrot ? "🦜 Yes" : "✨ No", inline: true },
                                { name: "\u200b", value: "\u200b", inline: true },
                                { name: "Seq2Seq Model", value: `\`${breakdown.model.toFixed(2)}\``, inline: true },
                                { name: "Domain LM", value: `\`${breakdown.domain_lm.toFixed(2)}\``, inline: true },
                                { name: "Generic LM", value: `\`${breakdown.generic_lm.toFixed(2)}\``, inline: true },
                                { name: "Length Bonus", value: `\`${breakdown.length.toFixed(2)}\``, inline: true },
                                { name: "Context Bonus", value: `\`${breakdown.context.toFixed(2)}\``, inline: true },
                                { name: "Applied Repeat Penalty", value: `\`${breakdown.repeat_penalty.toFixed(2)}\``, inline: true },
                                { name: "Temperature", value: `\`${params.temperature.toFixed(2)}\``, inline: true },
                                { name: "Default Repeat Penalty", value: `\`${params.repetition_penalty}\``, inline: true },
                                { name: "Top-P", value: `\`${params.top_p.toFixed(2)}\``, inline: true },
                                { name: "Top-K", value: `\`${params.top_k}\``, inline: true },
                                { name: "Min Length", value: `\`${params.min_len}\``, inline: true },
                                { name: "Max New Tokens", value: `\`${params.max_new_tokens}\``, inline: true },
                            );
                        embeds.push(candidateEmbed);
                    });

                    await message.reply({ content: reply.text, embeds });
                }
                else if (typeof reply === "string"){
                    await message.reply(reply);
                }
            }
            catch (err){
                Log.error("[AIWorker] Inference error:", err);
                await message.reply("Fehler: Bot moch grod ned so beep boop wie er soll... Frag Shadow warum er nix kann");
            }
        }
        /* if (config.ai_included_channels.includes(channelId)){
            brain.learn({
                id: message.id,
                content: cleanMsg(message) || "", // @ts-ignore
                authorId: message.author.id,
                replyToId: message.reference?.messageId ?? null,
                timestamp: message.createdTimestamp,
            });
        } */
    }
};

export default messageCreateHandler;
