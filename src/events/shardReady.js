import setStatus from "../util/setStatus.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle shard ready event
 *
 * @param {import("../service/client.js").default} client
 * @param {number} shard
 * @return {Promise<void>}
 */
const shardReady = async function(client, shard){
    Log.info(`Shard ${shard} is ready!`);
    const count = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
    await setStatus(client, count);

    // Reload guild count every 10 minutes if it changed
    let lastMemberCount = count;
    setInterval(async() => {
        const newMemberCount = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);

        if (newMemberCount !== lastMemberCount){
            lastMemberCount = newMemberCount;
            await setStatus(client, newMemberCount);
            Log.info(`Member count changed from ${count} to ${newMemberCount} (${(newMemberCount - count) > 0 ? "+" : ""}${(newMemberCount - count)}). Updated activity.`);
        }
    }, 10 * 60 * 1000);
};

export default shardReady;
