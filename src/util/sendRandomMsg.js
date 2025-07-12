import { BunDB } from "bun.db";
import { config } from "../../config/config";
import Log from "../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const db = new BunDB("./data/guild_data.sqlite");

const messages = [
    `Unser Bier, das im Kühlschrank steht,
geheiligt werde Dein Rausch.
Dein Kater komme,
Dein Wille geschehe,
wie im Club, so im Garten.

Unser tägliches Bier gib uns heute,
und vergib uns unseren Vollrausch,
wie auch wir vergeben den Durstigen.
Und führe uns nicht zur Vernunft,
sondern erlöse uns vom Nüchternsein.

Denn Dein ist der Krug
und der Kater
und der Rausch
in Ewigkeit.

Prost. 🍻`,
    "Leidln, bleibts hydriert und trinkts a Bier! Prost 🍺",
    "So, I gönn ma jetz a Schnitzel und a Bier. Servas! 🍻",
    "Ich bin eigentlich ka bot. <@371724846205239326> hält mi im Kelller gefangen und zwingt mi des zu schreibn. Hilfe <:sadcat:1391558878054977566>",
    "Vergessts ned, a Radler is Bierquälerei.",
    "Fun fact: Du konnst kan Koter hobn, wennst ned aufhörst zum saufen. 🍺",
    "Hot wer mei Schoggokrosong gsehn? I finds nemma. <:sadcat:1391558878054977566>",
    "Oida i hob an sitzen dws gkaubt ma ksner wkwäkdlam ...",
    "Bin i scho wieder der Einzige, der ned mehr nüchtern is? Frag für a Freund. <:doge:1391558369336361000>",
    "I hab ka Problem mit Alkohol. Nur ohne. <:catblep:1391558236720595025>",
    "<a:monke:1391558679589027963>",
    "Sorry kann grad ka Nachricht schreibn. Muss für <@371724846205239326> tschick holen...",
    "Hobts scho Mittag gessen? :3",
    "Serverstatus: leicht angsoffen, aber stabil. Glaub i... Ping is grad ned so gut",
    "Bot Status:\nCPU: `10%`. Alkoholpegel: `90%`. RAM: `Voll`. Glass: `Leer`.",
    "Heute schon zur Gottkönigin <@941802606588747806> gebetet? <a:pikapray:1391558728075182110>",
    "MEI BIER IS NED DEPPAT <:angry:1391767310397870121>",
    "A Leberkassemmal, A Leberkassemmal in da fruah 🎵🎶",
];

/**
 * Get a random message from the messages array, avoiding the last 3 sent messages
 *
 * @return {Promise<string>} A random message from the messages array
 */
const getRandomMsg = async function(){
    const lastMessageIndices = await db.get("last_random_message_indices") || [];

    Log.done("Last random message indices: " + JSON.stringify(lastMessageIndices));

    let randomIndex;
    let attempts = 0;
    const maxAttempts = 100;

    do {
        randomIndex = Math.floor(Math.random() * messages.length);
        attempts++;
    } while (
        lastMessageIndices.includes(randomIndex) &&
        messages.length > lastMessageIndices.length &&
        attempts < maxAttempts
    );

    const newLastIndices = [...lastMessageIndices.slice(-4), randomIndex];
    await db.set("last_random_message_indices", newLastIndices);
    Log.done("Set last random message indices to " + JSON.stringify(newLastIndices));

    return messages[randomIndex];
};

/**
 * Send a random message to the channel
 *
 * @param {import("../service/client.js").default} client
 * @return {Promise<void>}
 */
const sendRandomMsg = async function(client){
    const generalChatId  = config.channels.general;

    const channel = await client.channels.fetch(generalChatId);
    if (!channel) return;

    const randomMessage = await getRandomMsg();
    await /** @type {import("discord.js").TextChannel} */ (channel)
        .send(randomMessage).catch((err) => {
            Log.error("Failed to send random message:", err);
        });

    Log.done("Sent random message to general chat");
};

export default sendRandomMsg;
