// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Check if message is "too loud"
 *
 * @param {string} message
 * @return {boolean}
 */
const volumeDown = function(message){
    const individualCharacters = message.split("").filter((a) => !a.match(/\s/));
    if (message.indexOf(" ") === -1) return false;
    const uppercaseCharacters = individualCharacters.filter((a) =>
        a.match(/[A-Z]/),
    ).length;
    return uppercaseCharacters / individualCharacters.length >= 0.6;
};

/**
 * Handle messageCreate event
 *
 * @param {import("discord.js").Message} message
 * @return {Promise<void>}
 */
const jokes = async function(message){
    const msg = message.content.trim();
    const cleanedMsg = msg.toLowerCase().replace(/[^a-z0-9öäüß ]/g, "").trim();

    if (cleanedMsg.startsWith("prost")){
        await message.react("🍻").catch(() => {});
    }

    if (volumeDown(msg)){
        const responses = [
            "NED SO LAUT! Sonst bekommt Opi noch an Herzinfarkt <:kek:1398084145074278400>",
            "HEAST AUF ZUM SCHREIN! Des is ned gut für meinen Blutdruck <:okay:1392840354004205618>",
            "OIDA SEI LEISE. De Leit wuin schlofen <:angry:1393218787855040612>",
            "SCHREI NED SO SONST KRIAGST A WATSCHN",
        ];

        const response = responses[Math.floor(Math.random() * responses.length)];
        await message.reply(response).catch(() => {});
    }

    else if (cleanedMsg.startsWith("ich bin") || cleanedMsg.startsWith("i bin") || cleanedMsg.startsWith("i bims")){
        const words = cleanedMsg.split(" ").filter(Boolean);
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
