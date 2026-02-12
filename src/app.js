import EventEmitter from "node:events";
import fs from "node:fs";
import path from "node:path";
import { GatewayIntentBits, Events, ActivityType, Partials } from "discord.js";
import Log from "./util/log.js";
import { config, meta } from "../config/config.js";
import DiscordClient from "./service/client.js";
import api from "./service/api.js";
import clientReady from "./events/clientReady.js";
import shardReady from "./events/shardReady.js";
import guildMemberUpdate from "./events/guildMemberUpdate.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

EventEmitter.defaultMaxListeners = 20;

const client = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
    ],
    presence: {
        status: "dnd",
        activities: [{ name: "Startet...", type: ActivityType.Playing }],
    },
});

const appname = meta.getName();
const version = meta.getVersion();
const author = meta.getAuthor();
const pad = 16 + appname.length + version.toString().length + author.length;

Log.raw(
    "\n" +
    " #" + "-".repeat(pad) + "#\n" +
    " # Started " + appname + " v" + version + " by " + author + " #\n" +
    " #" + "-".repeat(pad) + "#\n",
);

Log.info("--- START ---");
Log.info(appname + " v" + version + " by " + author);

Log.debug("Bun Environment: " + process.env.NODE_ENV, true);
Log.debug("Bun version: " + Bun.version, true);
Log.debug("OS: " + process.platform + " " + process.arch, true);

Log.wait("Ensuring data dir...");
if (!fs.existsSync(path.resolve("./data"))){
    const dataDir = path.resolve("./data");
    fs.mkdirSync(dataDir);
    fs.closeSync(fs.openSync(path.resolve(dataDir, ".gitkeep"), "w"));
    Log.done("Created missing data dir!");
}
else Log.done("Data dir exists!");

client.on(Events.ClientReady, async() => clientReady(client));

client.on(Events.ShardReady, async shard => shardReady(client, shard));

client.on(Events.ShardError, (error, shardId) => Log.error(`Shard ${shardId} encountered an error:`, error));

client.on(Events.ShardDisconnect, (event, shardId) => Log.warn(`Shard ${shardId} disconnected with code ${event.code} and reason: ${event.reason}`));

client.on(Events.GuildCreate, async guild => Log.info("Joined guild: " + guild.name));

client.on(Events.GuildDelete, guild => Log.info("Left guild: " + guild.name));

client.on(Events.GuildUnavailable, guild => Log.warn("Guild is unavailable: " + guild.name));

client.on(Events.GuildMemberUpdate, async(oldMember, newMember) => guildMemberUpdate(oldMember, newMember));

client.on(Events.Debug, info => Log.debug(info, true));

client.on(Events.CacheSweep, info => Log.debug("Cache sweep: " + info));

client.on(Events.Warn, info => Log.warn(info));

client.on(Events.Error, err => Log.error("Client error.", err));

client.login(config.discord.bot_token)
    .then(() => Log.done("Logged in!"))
    .catch(err => Log.error("Failed to login: ", err));

api(client);

process.on("unhandledRejection", (
    /** @type {Error} */ err,
) => Log.error("Unhandled promise rejection: ", err));
