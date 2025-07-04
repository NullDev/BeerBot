import { ActivityType } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Set bot status
 *
 * @param {import("discord.js").Client} client
 * @param {number} count
 */
const setStatus = async function(client, count){
    client.user?.setActivity({ name: `Säuft Bier für ${count} Mitglieder.`, type: ActivityType.Playing });
    client.user?.setStatus("online");
};

export default setStatus;
