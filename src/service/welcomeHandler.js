import fs from "node:fs/promises";
import OpenAI from "openai";
import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/* eslint-disable no-nested-ternary */

const openai = new OpenAI({
    apiKey: config.openai.token,
});

/**
 * Prepare the prompt for usage
 *
 * @param {String} username
 * @returns {Promise<String>}
 */
const preparePrompt = async function(username){
    const prompt = await fs.readFile("./data/prompts/welcome.txt", "utf-8");

    const prepared = prompt
        .replace("{{date}}", new Date().toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }))
        .replace("{{username}}", username)
        .replace("{{time}}", new Date().toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
        }))
        .replace("{{timeofday}}", new Date().getHours() < 12
            ? "Morgen"
            : new Date().getHours() < 18
                ? "Tag"
                : "Abend",
        );

    return prepared;
};

/**
 * Welcome new members
 *
 * @param {import("discord.js").GuildMember} member
 */
const welcomeHandler = async function(member){
    const username = member.displayName ?? member.user.username;

    const prompt = await preparePrompt(username);
    const mainChat = config.channels.general;

    const channel = /** @type {import("discord.js").TextChannel} */ (await member.guild.channels.fetch(mainChat));
    if (!channel) return;

    const res = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [{
            content: prompt,
            role: "system",
        }, {
            content: "begrüßung: ",
            role: "user",
        }],
        n: 1,
    }).catch((error) => {
        Log.error("Error in welcomeHandler:", error);
        return null;
    });

    if (!res) return;

    const response = res.choices[0].message.content?.trim();
    if (!response) return;

    const userPing = `<@${member.id}> `;
    await channel.send(userPing + response);
};

export default welcomeHandler;
