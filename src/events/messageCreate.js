import { ChannelType } from "discord.js";
import { handleDMVerification } from "../service/dmVerification/dmVerification.js";
import jokes from "../service/jokes.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

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
    }
};

export default messageCreateHandler;
