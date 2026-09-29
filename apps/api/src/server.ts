import { env } from "./env.js";
import { buildApp } from "./app.js";
import { startCloudWorker } from "./agents/cloud.js";
import { sqlClient } from "./db/client.js";
import { startTelegram, stopTelegram } from "./telegram/bot.js";
import { deleteOrphanClips } from "./voice/service.js";

const app = await buildApp();

const cleanup = setInterval(
  () => deleteOrphanClips().catch((err) => app.log.warn({ err }, "Orphan clip cleanup failed")),
  60 * 60 * 1000,
);

let stopCloudWorker = async () => {};

const shutdown = async () => {
  clearInterval(cleanup);
  await stopCloudWorker();
  await stopTelegram();
  await app.close();
  await sqlClient.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
await startTelegram(app.log);
stopCloudWorker = startCloudWorker(app.log);
