import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { webhookCallback } from "grammy";
import type { TelegramLinkResponse, TelegramStatus } from "@lightbulb/shared";
import { env } from "../env.js";
import { requireUser } from "../auth/session.js";
import { HttpError } from "../lib/http.js";
import { runningBot, telegramInfo, usesWebhook } from "./bot.js";
import { createLinkCode, isTelegramLinked, unlinkTelegram } from "./service.js";

const botDisabled = () =>
  new HttpError(503, "telegram_disabled", "The Telegram bot isn't set up on this server yet");

export async function telegramRoutes(app: FastifyInstance) {
  app.get("/telegram/status", async (request): Promise<TelegramStatus> => {
    const user = requireUser(request);
    return { linked: await isTelegramLinked(user.id), botUsername: telegramInfo().botUsername };
  });

  app.post(
    "/telegram/link",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request): Promise<TelegramLinkResponse> => {
      const user = requireUser(request);
      const { botUsername } = telegramInfo();
      if (!botUsername) throw botDisabled();
      const { code, expiresAt } = await createLinkCode(user.id);
      return { url: `https://t.me/${botUsername}?start=${code}`, expiresAt: expiresAt.toISOString() };
    },
  );

  app.delete("/telegram/link", async (request, reply) => {
    const user = requireUser(request);
    await unlinkTelegram(user.id);
    return reply.status(204).send();
  });

  // Webhook mode only. Telegram signs each call with the secret we registered.
  let handle: ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) | null = null;
  app.post("/telegram/webhook", { config: { rateLimit: false } }, async (request, reply) => {
    const bot = runningBot();
    if (!bot || !usesWebhook()) throw botDisabled();
    handle ??= webhookCallback(bot, "fastify", { secretToken: env.TELEGRAM_WEBHOOK_SECRET });
    return handle(request, reply);
  });
}
