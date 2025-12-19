import { config } from "../../config/config.js";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * Handle voiceStateUpdate event
 *
 * @param {import("discord.js").VoiceState} oldState
 * @param {import("discord.js").VoiceState} newState
 * @return {Promise<void>}
 */
const voiceStateUpdateHandler = async function(oldState, newState){
    try {
        const joinedWaitingRoom = newState.channelId === config.channels.waiting_room_vc
            && oldState.channelId !== config.channels.waiting_room_vc;

        if (!joinedWaitingRoom) return;

        const {guild} = newState;
        const joiningUser = newState.member;

        const stammtischVoiceChannel = await guild.channels.fetch(config.channels.stammtisch_vc);
        if (!stammtischVoiceChannel || !stammtischVoiceChannel.isVoiceBased()){
            Log.warn("Stammtisch voice channel not found or is not a voice channel");
            return;
        }

        const membersInStammtisch = stammtischVoiceChannel.members;

        if (membersInStammtisch.size === 0){
            Log.info(`User ${joiningUser?.user.displayName} joined waiting room, but no one is in stammtisch voice channel`);
            return;
        }

        const pings = membersInStammtisch.map(member => member.toString()).join(" ");

        await stammtischVoiceChannel.send({
            content: `${pings}\n${joiningUser} is im Warteraum!`,
        });

        Log.done(`User ${joiningUser?.user.displayName} joined waiting room. Pinged ${membersInStammtisch.size} members in stammtisch`);
    }
    catch (error){
        Log.error("Error handling voice state update:", error);
    }
};

export default voiceStateUpdateHandler;
