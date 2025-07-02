import { ActivityType, Events } from "discord.js";
import registerCommands from "../service/commandRegister.js";
import scheduleCrons from "../service/cronScheduler.js";
import interactionCreateHandler from "./interactionCreate.js";
import messageCreateHandler from "./messageCreate.js";
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
        });

    await scheduleCrons(client);

    const count = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
    client.user?.setActivity({ name: `Säuft Bier für ${count} Mitglieder.`, type: ActivityType.Playing });
    client.user?.setStatus("online");
};

export default clientReady;
