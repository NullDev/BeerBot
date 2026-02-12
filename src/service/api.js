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

    // ... get methods ...

    app.listen({
        port,
    }, (err, address) => {
        if (err) Log.error("Failed to start Fastify Server: ", err);
        Log.done(`Fastify Server listening on ${address}`);
    });
};

export default api;
