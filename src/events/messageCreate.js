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
            if (message.content.trim() === `<@!${message.client.user?.id}>`) return;
            message.channel.sendTyping();
            let query = cleanMsg(message);

            // Check if [DEBUG] is present
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
                    // Create debug embed
                    const { EmbedBuilder } = await import("discord.js");
                    const embed = new EmbedBuilder()
                        .setTitle("🔍 AI Debug - LSTM Seq2Seq + Luong Attention + KenLM Reranker")
                        .setColor(0x5865F2);

                    // Sort candidates by score
                    const sortedCandidates = reply.debug.candidates
                        .map((cand, idx) => ({ ...cand, originalIndex: idx }))
                        .sort((a, b) => b.score - a.score);

                    // Find which candidate was selected
                    const selectedIndex = sortedCandidates.findIndex(c => c.text === reply.text);

                    // Show top 5 candidates
                    sortedCandidates.slice(0, 5).forEach((candidate, index) => {
                        const isSelected = index === selectedIndex;
                        const parrotIcon = candidate.parrot ? "🦜" : "✨";
                        const selectedIcon = isSelected ? "- **CHOSEN REPLY**" : "";

                        const {breakdown} = candidate;
                        const {params} = candidate;

                        const fieldValue = [
                            `- **Text:** "${candidate.text.substring(0, 80)}${candidate.text.length > 80 ? "..." : ""}"`,
                            `- **Scores:**\n  - Seq2Seq Model: \`${breakdown.model.toFixed(2)}\` ┃ Domain LM: \`${breakdown.domain_lm.toFixed(2)}\` ┃ Generic LM: \`${breakdown.generic_lm.toFixed(2)}\`\n  - **Final: \`${breakdown.total.toFixed(2)}\`**`,
                            `- **Bonuses:**\n  - Length: \`${breakdown.length.toFixed(2)}\` ┃ Context: \`${breakdown.context.toFixed(2)}\` ┃ Repeat Penalty: \`${breakdown.repeat_penalty.toFixed(2)}\``,
                            `- **Params:**\n  - Temp: \`${params.temperature.toFixed(2)}\` ┃ Rep-Pen: \`${params.repetition_penalty}\`\n  - Min-Len: \`${params.min_len}\` ┃ Max-New-Tok: \`${params.max_new_tokens}\`\n  - Top-P: \`${params.top_p.toFixed(2)}\` ┃ Top-K: \`${params.top_k}\``,
                            `- **Parroted:** ${candidate.parrot ? "Yes, message is in dataset" : "No, message is original"}`,
                        ].join("\n");

                        embed.addFields({
                            name: `---\n${parrotIcon} Candidate ${index + 1} ${selectedIcon}`,
                            value: fieldValue,
                            inline: false,
                        });
                    });

                    await message.reply({ content: reply.text, embeds: [embed] });
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
        if (config.ai_included_channels.includes(channelId)){
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
