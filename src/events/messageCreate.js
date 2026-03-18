import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";
import { PythonAIWorker } from "../ai/getAiReply.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

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

        // @ts-ignore
        if (message.mentions.has(message.client.user)){
            if (message.content.trim() === `<@!${message.client.user?.id}>`) return;
            message.channel.sendTyping();
            let query = cleanMsg(message);

            try {
                const prevMessages = await message.channel.messages.fetch({ limit: 4, before: message.id });
                if (prevMessages.size > 0){
                    const contexts = [];
                    for (const [, msg] of prevMessages){
                        if (!msg.author.bot && contexts.length < 3){
                            const content = cleanMsg(msg);
                            if (content && content.length > 0) contexts.push(content);
                        }
                    }
                    if (contexts.length > 0){
                        query = `${contexts.reverse().join(" ")} ${query}`;
                    }
                }
            }
            catch (e){
                Log.error("[AIWorker] Could not fetch previous messages for context: ", e);
            }

            try {
                const reply = await aiWorker.infer(query);
                await message.reply(reply);
            }
            catch (err){
                Log.error("[AIWorker] Inference error:", err);
                await message.reply("Fehler: Bot moch grod ned so beep boop wie er soll... Frag Shadow warum er nix kann");
            }
        }
    }
};

export default messageCreateHandler;
