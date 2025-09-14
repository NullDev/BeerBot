// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle messageCreate event
 *
 * @param {import("discord.js").Message} message
 * @return {Promise<void>}
 */
const jokes = async function(message){
    const msg = message.content.toLowerCase().replace(/[^a-z0-9öäüß ]/g, "").trim();

    if (msg.startsWith("prost")){
        await message.react("🍻").catch(() => {});
    }

    else if (msg.startsWith("ich bin") || msg.startsWith("i bin") || msg.startsWith("i bims")){
        const words = msg.split(" ").filter(Boolean);
        if (words.length <= 5){
            let name = words.slice(2).join(" ");
            if (name.length > 0){
                const firstLetter = name.charAt(0).toUpperCase();
                const rest = name.slice(1);
                name = firstLetter + rest;
            }
            if (name.length > 0 && name.length <= 32){
                await message.reply(`Hallo ${name}, ich bin Bierli! 🍺`).catch(() => {});
            }
        }
    }
};

export default jokes;
