import {
    SlashCommandBuilder,
    InteractionContextType,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
} from "discord.js";
import { Database as BunDB } from "bun:sqlite";
import { config } from "../../../config/config.js";
import Log from "../../util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const commandName = import.meta.url.split("/").pop()?.split(".").shift() ?? "";
const brainDb = new BunDB("./data/brain.sqlite");

/**
 * Get user's message count
 *
 * @param {string} userId
 * @return {number}
 */
const getUserMessageCount = function(userId){
    const result = brainDb.query("SELECT COUNT(*) as count FROM messages WHERE authorId = ?").get(userId);
    return result?.count || 0;
};

/**
 * Get user's top channels
 *
 * @param {string} userId
 * @param {number} limit
 * @return {Array<{channelId: string, count: number}>}
 */
const getUserTopChannels = function(userId, limit = 3){
    const results = brainDb.query(`
        SELECT channelId, COUNT(*) as count
        FROM messages
        WHERE authorId = ?
        GROUP BY channelId
        ORDER BY count DESC
        LIMIT ?
    `).all(userId, limit);
    return results || [];
};

/**
 * Get user's top emotes (server emotes only)
 *
 * @param {string} userId
 * @param {import("discord.js").Guild} guild
 * @param {number} limit
 * @return {Array<{emoteId: string, emoteName: string, count: number}>}
 */
const getUserTopEmotes = function(userId, guild, limit = 5){
    const messages = brainDb.query("SELECT content FROM messages WHERE authorId = ?").all(userId);

    const emoteCounts = new Map();

    const cleanedEmoteRegex = /:(\w+):/g;

    for (const msg of messages){
        if (!msg.content) continue;

        cleanedEmoteRegex.lastIndex = 0;
        let match = cleanedEmoteRegex.exec(msg.content);
        while (match !== null){
            const emoteName = match[1];
            match = cleanedEmoteRegex.exec(msg.content);

            const serverEmote = guild.emojis.cache.find(e => e.name === emoteName);

            if (serverEmote){
                const key = `${emoteName}:${serverEmote.id}`;
                emoteCounts.set(key, (emoteCounts.get(key) || 0) + 1);
            }
        }
    }

    return Array.from(emoteCounts.entries())
        .map(([key, count]) => {
            const [emoteName, emoteId] = key.split(":");
            return { emoteId, emoteName, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
};

/**
 * Get percentile for age group
 *
 * @param {string} userId
 * @param {import("discord.js").Guild} guild
 * @return {Promise<{ageGroup: string, percentile: number, memberCount: number, totalMembers: number}>}
 */
const getAgeGroupPercentile = async function(userId, guild){
    const ageRoles = config.roles.ages;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { ageGroup: "Unknown", percentile: 0, memberCount: 0, totalMembers: 0 };

    let userAgeGroup = null;
    let userRoleCount = 0;

    for (const [ageRange, roleId] of Object.entries(ageRoles)){
        if (!roleId) continue;

        const role = await guild.roles.fetch(roleId);
        if (!role) continue;

        if (member.roles.cache.has(roleId)){
            userAgeGroup = ageRange.replace("_", "-").replace("+", "+");
            userRoleCount = role.members.size;
            break;
        }
    }

    if (!userAgeGroup) return { ageGroup: "Unknown", percentile: 0, memberCount: 0, totalMembers: 0 };

    let totalMembers = 0;
    for (const [, roleId] of Object.entries(ageRoles)){
        if (!roleId) continue;
        const role = await guild.roles.fetch(roleId);
        if (role) totalMembers += role.members.size;
    }

    const percentile = totalMembers > 0 ? ((userRoleCount / totalMembers) * 100) : 0;

    return {
        ageGroup: userAgeGroup,
        percentile,
        memberCount: userRoleCount,
        totalMembers,
    };
};

/**
 * Get percentile for bundesland
 *
 * @param {string} userId
 * @param {import("discord.js").Guild} guild
 * @return {Promise<{bundesland: string, percentile: number, memberCount: number, totalMembers: number}>}
 */
const getBundeslandPercentile = async function(userId, guild){
    const bundeslandRoles = { ...config.roles.country_verified, ...config.roles.country_unverified };

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { bundesland: "Unknown", percentile: 0, memberCount: 0, totalMembers: 0 };

    let userBundesland = null;
    let userRoleCount = 0;

    for (const [bundeslandCode, roleId] of Object.entries(bundeslandRoles)){
        if (!roleId) continue;

        const role = await guild.roles.fetch(roleId);
        if (!role) continue;

        if (member.roles.cache.has(roleId)){
            userBundesland = bundeslandCode.toUpperCase();
            userRoleCount = role.members.size;
            break;
        }
    }

    if (!userBundesland) return { bundesland: "Unknown", percentile: 0, memberCount: 0, totalMembers: 0 };

    let totalMembers = 0;
    const uniqueRoles = new Set();
    for (const [, roleId] of Object.entries(bundeslandRoles)){
        if (!roleId || uniqueRoles.has(roleId)) continue;
        uniqueRoles.add(roleId);
        const role = await guild.roles.fetch(roleId);
        if (role) totalMembers += role.members.size;
    }

    const percentile = totalMembers > 0 ? ((userRoleCount / totalMembers) * 100) : 0;

    return {
        bundesland: userBundesland,
        percentile,
        memberCount: userRoleCount,
        totalMembers,
    };
};

/**
 * Calculate uniqueness percentile based on age, bundesland, and gender combination
 *
 * @param {string} userId
 * @param {import("discord.js").Guild} guild
 * @return {Promise<number>}
 */
const getUniquenessPercentile = async function(userId, guild){
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return 0;

    const userAgeRole = Object.values(config.roles.ages).find(roleId => roleId && member.roles.cache.has(roleId));
    const userGenderRole = Object.values(config.roles.gender).find(roleId => roleId && member.roles.cache.has(roleId));
    const userBundeslandRole = [...Object.values(config.roles.country_verified), ...Object.values(config.roles.country_unverified)]
        .find(roleId => roleId && member.roles.cache.has(roleId));

    if (!userAgeRole || !userGenderRole || !userBundeslandRole) return 0;

    const members = await guild.members.fetch();
    let sameComboCount = 0;

    for (const [, guildMember] of members){
        if (guildMember.roles.cache.has(userAgeRole) &&
            guildMember.roles.cache.has(userGenderRole) &&
            guildMember.roles.cache.has(userBundeslandRole)){
            sameComboCount++;
        }
    }

    const totalVerifiedMembers = members.filter(m =>
        m.roles.cache.has(config.roles.verified),
    ).size;

    if (totalVerifiedMembers === 0) return 0;

    const uniquenessScore = 100 - ((sameComboCount / totalVerifiedMembers) * 100);
    return Math.max(0, Math.min(100, uniquenessScore));
};

/**
 * Count bot mentions
 *
 * @param {string} userId
 * @param {string} botId
 * @return {number}
 */
const getBotMentionCount = function(userId, botId){
    const messages = brainDb.query("SELECT content FROM messages WHERE authorId = ?").all(userId);

    let count = 0;
    const mentionRegex = new RegExp(`<@!?${botId}>`, "g");

    for (const msg of messages){
        if (!msg.content) continue;
        const matches = msg.content.match(mentionRegex);
        if (matches) count += matches.length;
    }

    return count;
};

/**
 * Count specific user mentions
 *
 * @param {string} userId
 * @param {string} targetUserId
 * @return {number}
 */
const getUserMentionCount = function(userId, targetUserId){
    const messages = brainDb.query("SELECT content FROM messages WHERE authorId = ?").all(userId);

    let count = 0;
    const mentionRegex = new RegExp(`<@!?${targetUserId}>`, "g");

    for (const msg of messages){
        if (!msg.content) continue;
        const matches = msg.content.match(mentionRegex);
        if (matches) count += matches.length;
    }

    return count;
};

/**
 * Calculate Night Owl Score (percentage of messages sent between midnight and 6am)
 *
 * @param {string} userId
 * @return {number}
 */
const getNightOwlScore = function(userId){
    const messages = brainDb.query("SELECT ts FROM messages WHERE authorId = ?").all(userId);

    if (messages.length === 0) return 0;

    let nightMessages = 0;

    for (const msg of messages){
        if (!msg.ts) continue;

        const date = new Date(msg.ts);
        const hour = date.getHours();

        if (hour >= 0 && hour < 6){
            nightMessages++;
        }
    }

    return (nightMessages / messages.length) * 100;
};

/**
 * Get user's most used word (excluding common German words)
 *
 * @param {string} userId
 * @return {{word: string, count: number} | null}
 */
const getMostUsedWord = function(userId){
    const messages = brainDb.query("SELECT content FROM messages WHERE authorId = ?").all(userId);

    // Common German words to exclude
    const stopWords = new Set([
        "der", "die", "das", "den", "dem", "des",
        "ein", "eine", "einer", "einem", "einen", "eines",
        "und", "oder", "aber", "doch", "denn", "sondern",
        "ich", "du", "er", "sie", "es", "wir", "ihr",
        "mich", "dich", "sich", "uns", "euch",
        "mein", "dein", "sein", "ihr", "unser", "euer",
        "ist", "sind", "war", "waren", "bin", "bist",
        "habe", "hast", "hat", "haben", "hatte", "hatten",
        "kann", "kannst", "konnte", "konnten",
        "auf", "in", "an", "bei", "mit", "nach", "von", "zu", "aus", "um",
        "nicht", "auch", "nur", "noch", "schon", "mal", "ja", "nein",
        "was", "wie", "wo", "wann", "warum", "wer",
        "so", "dann", "wenn", "als", "da", "damit",
    ]);

    const wordCounts = new Map();

    for (const msg of messages){
        if (!msg.content) continue;

        const words = msg.content.toLowerCase()
            .split(/\s+/)
            .map((/** @type {string} */ w) => w.replace(/[.,!?;:()]/g, ""))
            .filter((/** @type {string} */ w) => w.length > 2 && !stopWords.has(w));

        for (const word of words){
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
    }

    if (wordCounts.size === 0) return null;

    let maxWord = null;
    let maxCount = 0;

    for (const [word, count] of wordCounts.entries()){
        if (count > maxCount){
            maxCount = count;
            maxWord = word;
        }
    }

    return maxWord ? { word: maxWord, count: maxCount } : null;
};

/**
 * Get user's first message ever
 *
 * @param {string} userId
 * @return {{content: string, timestamp: number, channelId: string} | null}
 */
const getFirstMessage = function(userId){
    const result = brainDb.query(`
        SELECT content, ts, channelId
        FROM messages
        WHERE authorId = ?
        ORDER BY ts ASC
        LIMIT 1
    `).get(userId);

    if (!result) return null;

    return {
        content: result.content || "",
        timestamp: result.ts || 0,
        channelId: result.channelId || "",
    };
};

export default {
    data: new SlashCommandBuilder()
        .setName(commandName)
        .setDescription("Zeig dein BundesBeer Wrapped 2025")
        .setContexts([InteractionContextType.Guild]),
    /**
     * @param {import("../../types.js").CommandInteractionWithOptions} interaction
     */
    async execute(interaction){
        try {
            const { user, guild, client } = interaction;

            if (!guild){
                return await interaction.reply({
                    content: "❌ Konn ned auf den Server zugreifen.",
                });
            }

            await interaction.deferReply();

            const member = await guild.members.fetch(user.id).catch(() => null);
            const joinDate = member?.joinedAt ? member.joinedAt.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
            }) : "Unbekannt";

            const [
                messageCount,
                topChannels,
                topEmotes,
                ageGroupData,
                bundeslandData,
                uniquenessPercentile,
                botMentionCount,
                specialUserMentionCount,
                nightOwlScore,
                mostUsedWord,
                firstMessage,
            ] = await Promise.all([
                Promise.resolve(getUserMessageCount(user.id)),
                Promise.resolve(getUserTopChannels(user.id, 3)),
                Promise.resolve(getUserTopEmotes(user.id, guild, 5)),
                getAgeGroupPercentile(user.id, guild),
                getBundeslandPercentile(user.id, guild),
                getUniquenessPercentile(user.id, guild),
                Promise.resolve(getBotMentionCount(user.id, client.user.id)),
                Promise.resolve(getUserMentionCount(user.id, "941802606588747806")),
                Promise.resolve(getNightOwlScore(user.id)),
                Promise.resolve(getMostUsedWord(user.id)),
                Promise.resolve(getFirstMessage(user.id)),
            ]);

            const totalPages = 6;
            let currentPage = 0;

            /**
             * Build message content for a specific page
             *
             * @param {number} pageIndex
             * @return {Object}
             */
            const buildMessageData = (pageIndex) => {
                const container = new ContainerBuilder().addTextDisplayComponents(t =>
                    t.setContent(`## 📊 ${user.username}'s BundesBeer Wrapped 2025`),
                );

                switch (pageIndex){
                    case 0: {
                        let activityText;
                        if (messageCount > 1000) activityText = "Bischt scho ziemlich aktiv! 💬";
                        else if (messageCount > 100) activityText = "Do geht no wos! 😊";
                        else activityText = "Sei mol aktiver! 😄";

                        container.addTextDisplayComponents(
                            t => t.setContent("### 🎉 Allgemeine Infos\n"),
                            t => t.setContent(
                                `**Beigetreten am:** ${joinDate}\n\n` +
                                `**Nachrichten geschrieben:** ${messageCount.toLocaleString("de-DE")}\n\n` +
                                activityText,
                            ),
                        );
                        break;
                    }

                    case 1: {
                        container.addTextDisplayComponents(
                            t => t.setContent("### 📺 Deine Top 3 Channels\n"),
                        );

                        if (topChannels.length > 0){
                            const channelList = topChannels.map((ch, idx) => {
                                const channel = guild.channels.cache.get(ch.channelId);
                                const channelName = channel ? `<#${ch.channelId}>` : "Unbekannter Channel";
                                return `${idx + 1}. ${channelName} - **${ch.count}** Nachrichten`;
                            }).join("\n");

                            container.addTextDisplayComponents(
                                t => t.setContent(channelList),
                            );
                        }
                        else {
                            container.addTextDisplayComponents(
                                t => t.setContent("Keine Channel-Daten verfügbar."),
                            );
                        }

                        container.addTextDisplayComponents(
                            t => t.setContent("\n### 😀 Deine Top 5 Server-Emotes\n"),
                        );

                        if (topEmotes.length > 0){
                            const emoteList = topEmotes.map((emote, idx) => {
                                const emoji = guild.emojis.cache.get(emote.emoteId);
                                const display = emoji ? `${emoji}` : `:${emote.emoteName}:`;
                                return `${idx + 1}. ${display} - **${emote.count}** mal verwendet`;
                            }).join("\n");

                            container.addTextDisplayComponents(
                                t => t.setContent(emoteList),
                            );
                        }
                        else {
                            container.addTextDisplayComponents(
                                t => t.setContent("Keine Emote-Statistiken verfügbar."),
                            );
                        }
                        break;
                    }

                    case 2: {
                        container.addTextDisplayComponents(
                            t => t.setContent("### 📊 Demografische Daten\n"),
                        );

                        if (ageGroupData.ageGroup !== "Unknown"){
                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    `**Altersgruppe:** ${ageGroupData.ageGroup} Jahre\n` +
                                    `**Mitglieder in deiner Altersgruppe:** ${ageGroupData.memberCount}\n` +
                                    `**Anteil an ollen Mitgliedern:** ${ageGroupData.percentile.toFixed(1)}%\n\n`,
                                ),
                            );
                        }
                        else {
                            container.addTextDisplayComponents(
                                t => t.setContent("**Altersgruppe:** Nicht verifiziert\n\n"),
                            );
                        }

                        if (bundeslandData.bundesland !== "Unknown"){
                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    `**Bundesland:** ${bundeslandData.bundesland}\n` +
                                    `**Mitglieder aus deinem Bundesland:** ${bundeslandData.memberCount}\n` +
                                    `**Anteil an ollen Mitgliedern:** ${bundeslandData.percentile.toFixed(1)}%`,
                                ),
                            );
                        }
                        else {
                            container.addTextDisplayComponents(
                                t => t.setContent("**Bundesland:** Nicht verifiziert"),
                            );
                        }
                        break;
                    }

                    case 3: {
                        container.addTextDisplayComponents(
                            t => t.setContent("### ✨ Wie unique bist du?\n"),
                        );

                        if (uniquenessPercentile > 0){
                            let uniquenessText = "";
                            if (uniquenessPercentile >= 90){
                                uniquenessText = "Du bist extrem unique! 🌟 Fost niemand hot die gleiche Kombination wie du!";
                            }
                            else if (uniquenessPercentile >= 70){
                                uniquenessText = "Du bist ziemlich unique! ✨ Dei Kombination ist selten!";
                            }
                            else if (uniquenessPercentile >= 50){
                                uniquenessText = "Du bist durchschnittlich unique! 😊";
                            }
                            else if (uniquenessPercentile >= 30){
                                uniquenessText = "Dei Kombination ist relativ häufig! 📊";
                            }
                            else {
                                uniquenessText = "Dei Kombination ist sehr häufig! 👥";
                            }

                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    "Basierend auf deiner Kombination aus **Alter**, **Geschlecht** und **Bundesland**:\n\n" +
                                    `**Uniqueness Score:** ${uniquenessPercentile.toFixed(1)}%\n\n` +
                                    uniquenessText,
                                ),
                            );
                        }
                        else {
                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    "Du musst verifiziert sein, um deinen Uniqueness Score zu sehen!\n\n" +
                                    "Verifiziere dich mit dem Button am Server!",
                                ),
                            );
                        }
                        break;
                    }

                    case 4: {
                        container.addTextDisplayComponents(
                            t => t.setContent("### ✨ Random Stats\n"),
                        );

                        let nightOwlText;
                        if (nightOwlScore >= 30) nightOwlText = "Du bist a echter Nachtmensch! 🦉";
                        else if (nightOwlScore >= 15) nightOwlText = "Du schreibst gern nachts! 🌃";
                        else if (nightOwlScore >= 5) nightOwlText = "Ab und zu a Nachteule! 🌙";
                        else nightOwlText = "Du schläfst nachts wie normale Menschen! 😴";

                        container.addTextDisplayComponents(
                            t => t.setContent(
                                `**🌙 Night Owl Score:** ${nightOwlScore.toFixed(1)}%\n` +
                                `${nightOwlText}\n` +
                                `-# ${nightOwlScore.toFixed(1)}% deiner Nochrichten wurden zwischen 0:00 und 6:00 Uhr gsendet\n\n`,
                            ),
                        );

                        if (mostUsedWord){
                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    `**💬 Dei meist genutztes Wort:** "${mostUsedWord.word}"\n` +
                                    `Verwendet: **${mostUsedWord.count}** mal\n\n`,
                                ),
                            );
                        }

                        if (firstMessage && firstMessage.content){
                            const firstMsgDate = new Date(firstMessage.timestamp).toLocaleDateString("de-DE", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                            });
                            const channel = guild.channels.cache.get(firstMessage.channelId);
                            const channelMention = channel ? `<#${firstMessage.channelId}>` : "am gelöschten Channel";

                            // Truncate message if too long
                            const displayContent = firstMessage.content.length > 100
                                ? firstMessage.content.substring(0, 100) + "..."
                                : firstMessage.content;

                            container.addTextDisplayComponents(
                                t => t.setContent(
                                    "**📜 Dei erste Nachricht:**\n" +
                                    `Am ${firstMsgDate} in ${channelMention}:\n` +
                                    `> ${displayContent}`,
                                ),
                            );
                        }
                        break;
                    }

                    case 5: {
                        let botText;
                        if (botMentionCount > 50) botText = "Du liebst mi wohl! 💖";
                        else if (botMentionCount > 10) botText = "Donkschen für Aufmerksamkeit! 😊";
                        else botText = "Red mol öfter mit mia! 👋";

                        let specialText = "";
                        if (specialUserMentionCount > 50) specialText = "Bist vielleicht a bissi zu fanatisch! 🌟";
                        else if (specialUserMentionCount > 10) specialText = "Da geht noch wos 🤝";
                        else specialText = "Nerv Caly mal a bissi mehr! 🐱";

                        container.addTextDisplayComponents(
                            t => t.setContent("### 🤖 Erwähnungen\n"),
                            t => t.setContent(
                                `**Bot erwähnt:** ${botMentionCount} mal\n` +
                                `${botText}\n\n` +
                                `**Caly erwähnt:** ${specialUserMentionCount} mal\n` +
                                specialText,
                            ),
                        );
                        break;
                    }

                    default: {
                        container.addTextDisplayComponents(
                            t => t.setContent("Ungültige Seite."),
                        );
                    }
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`wrapped_prev_${user.id}`)
                        .setLabel("← Zurück")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageIndex <= 0),
                    new ButtonBuilder()
                        .setCustomId(`wrapped_next_${user.id}`)
                        .setLabel("Weiter →")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageIndex >= totalPages - 1),
                );

                return {
                    components: [container, row],
                    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
                };
            };

            const response = await interaction.editReply(buildMessageData(currentPage));

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i => i.user.id === user.id,
                time: 300_000, // 5 minutes
            });

            collector.on("collect", async i => {
                await i.deferUpdate();

                if (i.customId === `wrapped_prev_${user.id}`){
                    currentPage = Math.max(0, currentPage - 1);
                }
                else if (i.customId === `wrapped_next_${user.id}`){
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                }

                await i.editReply(buildMessageData(currentPage));
            });

            return collector.on("end", async() => {
                try {
                    const container = new ContainerBuilder().addTextDisplayComponents(t =>
                        t.setContent(`## 📊 ${user.username}'s BundesBeer Wrapped 2025`),
                    );
                    await response.edit({
                        components: [container],
                    });
                }
                catch {
                    Log.warn("Could not remove buttons from wrapped message:");
                }
            });
        }
        catch (error){
            Log.error("Error in wrapped command:", error);

            if (interaction.deferred){
                return await interaction.editReply({
                    content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
                });
            }

            return await interaction.reply({
                content: "❌ Es is a Fehler auftreten. Bitte versuachs später no amol.",
            });
        }
    },
};
