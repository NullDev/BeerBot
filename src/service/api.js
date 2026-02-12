import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Log from "../util/log";
import { config } from "../../config/config";

const { secret, port } = config.api;

/**
 * Start the API server
 *
 * @param {import("../service/client.js").default} client
 */
const api = function(client){
    const app = fastify();

    app.register(cors, { origin: "*" });
    app.register(helmet);

    app.addHook("onRequest", async(request, reply) => {
        if (request.headers.authorization !== secret){
            Log.warn("Unauthorized API access attempt from " + request.ip);
            return reply.code(401).send({ error: "Unauthorized" });
        }
        return null;
    });

    app.get("/stats/ages", async(_request, reply) => {
        const guild = client.guilds.cache.first();
        if (!guild) return reply.code(503).send({ error: "Guild not available" });

        const ageRoles = config.roles.ages;
        const stats = [];

        for (const [ageRange, roleId] of Object.entries(ageRoles)){
            if (!roleId) continue;

            const role = await guild.roles.fetch(roleId);
            if (!role) continue;

            stats.push({
                ageRange: ageRange.replace("_", "-"),
                memberCount: role.members.size,
            });
        }

        stats.sort((a, b) => b.memberCount - a.memberCount);
        const total = stats.reduce((sum, s) => sum + s.memberCount, 0);

        return { stats, total };
    });

    const regionNames = {
        oo: "Oberösterreich",
        no: "Niederösterreich",
        sb: "Salzburg",
        st: "Steiermark",
        wi: "Wien",
        bg: "Burgenland",
        kt: "Kärnten",
        tr: "Tirol",
        vb: "Vorarlberg",
        other: "Sonstige",
    };

    app.get("/stats/regions", async(_request, reply) => {
        const guild = client.guilds.cache.first();
        if (!guild) return reply.code(503).send({ error: "Guild not available" });

        const verifiedRoles = config.roles.country_verified;
        const unverifiedRoles = config.roles.country_unverified;
        const stats = [];

        for (const [region, roleId] of Object.entries(verifiedRoles)){
            if (!roleId) continue;

            let memberCount = 0;

            const verifiedRole = await guild.roles.fetch(roleId);
            if (verifiedRole) memberCount += verifiedRole.members.size;

            // @ts-ignore
            const unverifiedRoleId = unverifiedRoles[region];
            if (unverifiedRoleId){
                const unverifiedRole = await guild.roles.fetch(unverifiedRoleId);
                if (unverifiedRole) memberCount += unverifiedRole.members.size;
            }

            stats.push({
                // @ts-ignore
                region: regionNames[region] || region,
                regionCode: region,
                memberCount,
            });
        }

        stats.sort((a, b) => b.memberCount - a.memberCount);
        const total = stats.reduce((sum, s) => sum + s.memberCount, 0);

        return { stats, total };
    });

    app.listen({
        port,
    }, (err, address) => {
        if (err) Log.error("Failed to start Fastify Server: ", err);
        Log.done(`Fastify Server listening on ${address}`);
    });
};

export default api;
