import { BunDB } from "bun.db";
import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

/**
 * Ping random user
 *
 * @param {import("../service/client.js").default} client
 * @return {Promise<void>}
 */
const pingRandom = async(client) => {
    const channel = /** @type {import("discord.js").TextChannel} */ (await client.channels.fetch(config.channels.general));
    if (!channel || !channel.isTextBased()){
        Log.warn("General channel not found or is not a text channel");
        return;
    }

    const membersWithAccess = channel.members.filter(member => !member.user.bot);
    if (membersWithAccess.size === 0){
        Log.info("No members with access to general channel");
        return;
    }

    const last10Users = /** @type {string[]} */ (await db.get("pingRandom.last10Users") ?? []);

    const eligibleMembers = membersWithAccess.filter(member => !last10Users.includes(member.id));
    if (eligibleMembers.size === 0){
        Log.info("No eligible members for random pick, resetting last10Users");
        await db.set("pingRandom.last10Users", []);
        return;
    }

    const randomMember = eligibleMembers.random();
    if (!randomMember){
        Log.info("No random member found, this should not happen");
        return;
    }

    await channel.send(`Servas ${randomMember}! 👋\nDu bist des BB Mitglied des Tages <:cutecat:1398016390006309048>`);
    last10Users.push(randomMember.id);
    if (last10Users.length > 10) last10Users.shift();
    await db.set("pingRandom.last10Users", last10Users);
};

export default pingRandom;
