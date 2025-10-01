import fs from "node:fs";
import { Events } from "discord.js";
import registerCommands from "../service/commandRegister.js";
import scheduleCrons from "../service/cronScheduler.js";
import interactionCreateHandler from "./interactionCreate.js";
import messageCreateHandler from "./messageCreate.js";
import guildMemberAddHandler from "./guildMemberAdd.js";
import guildMemberRemoveHandler from "./guildMemberRemove.js";
import setStatus from "../util/setStatus.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle client ready event
 *
 * @param {import("../service/client.js").default} client
 * @return {Promise<void>}
 */
const clientReady = async function(client){
    Log.done("Client is ready!");
    Log.info("Logged in as '" + client.user?.tag + "'!");

    await registerCommands(client)
        .then(() => {
            client.on(Events.InteractionCreate, async interaction => interactionCreateHandler(interaction));
            client.on(Events.MessageCreate, async message => messageCreateHandler(message));
            client.on(Events.GuildMemberAdd, async member => guildMemberAddHandler(member));
            client.on(Events.GuildMemberRemove, async member => guildMemberRemoveHandler(member));
        });

    await scheduleCrons(client);

    const count = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
    await setStatus(client, count);

    Log.wait("Exporting Server Emojis to JSON file...");
    const emojiData = {};
    client.emojis.cache.forEach(emoji => { // @ts-ignore
        emojiData[":" + emoji.name + ":"] = "<" + (emoji.animated ? "a" : "") + ":" + emoji.name + ":" + emoji.id + ">";
    });
    fs.writeFileSync("data/emojis.json", JSON.stringify(emojiData, null, 4), { encoding: "utf-8" });
    Log.done("Exported " + client.emojis.cache.size + " emojis to data/emojis.txt");
};

export default clientReady;
