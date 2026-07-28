import { env } from "./config/env.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API server listening on http://localhost:${env.PORT}`);
});
