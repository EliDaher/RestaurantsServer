import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createServer } from "node:http";
import { attachRealtime } from "./realtime.js";
const app = createApp();
const server = createServer(app);
attachRealtime(server);
server.listen(env.PORT, () => {
    console.log(`API server listening on http://localhost:${env.PORT}`);
});
