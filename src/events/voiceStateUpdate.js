import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const WAITING_ROOM_PAIRS = [
    { waitingRoom: "waiting_room_vc", mainVc: "stammtisch_vc", label: "stammtisch" },
    { waitingRoom: "mausi_waiting_room_vc", mainVc: "mausi_vc", label: "mausi" },
];

/**
 * Handle voiceStateUpdate event
 *
 * @param {import("discord.js").VoiceState} oldState
 * @param {import("discord.js").VoiceState} newState
 * @return {Promise<void>}
 */
const voiceStateUpdateHandler = async function(oldState, newState){
    try {
        const pair = WAITING_ROOM_PAIRS.find( // @ts-ignore
            ({ waitingRoom }) => newState.channelId === config.channels[waitingRoom] && oldState.channelId !== config.channels[waitingRoom],
        );

        if (!pair) return;

        const {guild} = newState;
        const joiningUser = newState.member;

        if (joiningUser?.user.bot){
            Log.info(`Bot ${joiningUser.user.username} joined waiting room, ignoring`);
            return;
        }

        // @ts-ignore
        const mainVoiceChannel = await guild.channels.fetch(config.channels[pair.mainVc]);
        if (!mainVoiceChannel || !mainVoiceChannel.isVoiceBased()){
            Log.warn(`${pair.label} voice channel not found or is not a voice channel`);
            return;
        }

        const membersInMain = mainVoiceChannel.members;

        if (membersInMain.size === 0){
            Log.info(`User ${joiningUser?.user.displayName} joined waiting room, but no one is in ${pair.label} voice channel`);
            return;
        }

        const pings = membersInMain.map(member => member.toString()).join(" ");

        await mainVoiceChannel.send({
            content: `${pings}\n\n${joiningUser} is im ${pair.label} Warteraum!`,
        });

        Log.done(`User ${joiningUser?.user.displayName} joined waiting room. Pinged ${membersInMain.size} members in ${pair.label}`);
    }
    catch (error){
        Log.error("Error handling voice state update:", error);
    }
};

export default voiceStateUpdateHandler;
