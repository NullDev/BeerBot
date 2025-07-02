import { handleDMVerification } from "../service/dmVerification/dmVerification.js";

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
    if (message.channel.type === 1){ // DMChannel
        await handleDMVerification(message);
    }
};

export default messageCreateHandler;
