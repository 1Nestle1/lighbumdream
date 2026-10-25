import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { ApiErrorBody, HealthResponse } from "@lightbulb/shared";
import { env, isProd } from "./env.js";
import { mailerConfigured } from "./auth/mailer.js";
import { agentRoutes } from "./agents/routes.js";
import { authRoutes } from "./auth/routes.js";
import { registerSession } from "./auth/session.js";
import { folderRoutes } from "./folders/routes.js";
import { ideaRoutes } from "./ideas/routes.js";
import { integrationRoutes } from "./integrations/routes.js";
import { notebookRoutes } from "./notebook/routes.js";
import { HttpError } from "./lib/http.js";
import { aiSuggestionsEnabled } from "./suggest/index.js";
import { telegramRoutes } from "./telegram/routes.js";
import { telegramInfo } from "./telegram/bot.js";
import { voiceRoutes } from "./voice/routes.js";
import { voiceAvailable } from "./voice/whisper.js";

const DB_DOWN_CODES = new Set(["CONNECT_TIMEOUT", "ECONNREFUSED", "ECONNRESET", "CONNECTION_CLOSED", "CONNECTION_ENDED"]);

/** True when the error (or what Drizzle wrapped) is a failed connection to Postgres. */
function isDatabaseDown(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return DB_DOWN_CODES.has(code(err) ?? "") || DB_DOWN_CODES.has(code((err as { cause?: unknown } | null)?.cause) ?? "");
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: isProd ? "info" : "debug" },
    trustProxy: isProd,
  });

  await app.register(cookie);
  // Session resolution runs before rate limiting so limits can key on the user.
  registerSession(app);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((err, request, reply) => {
    let status = 500;
    let body: ApiErrorBody = { error: "internal", message: "Something went wrong" };

    if (err instanceof ZodError) {
      status = 400;
      body = { error: "validation", message: "Some fields are invalid", issues: err.issues };
    } else if (isDatabaseDown(err)) {
      status = 503;
      body = { error: "db_unavailable", message: "The database isn't reachable right now" };
    } else if (err instanceof HttpError) {
      status = err.statusCode;
      body = { error: err.code, message: err.message };
    } else if (typeof err === "object" && err && "statusCode" in err) {
      const statusCode = Number(err.statusCode);
      if (statusCode >= 400 && statusCode < 500) {
        status = statusCode;
        body = {
          error: statusCode === 429 ? "rate_limited" : statusCode === 413 ? "too_large" : "bad_request",
          message:
            statusCode === 429
              ? "Too many requests, slow down a little"
              : "message" in err
                ? String(err.message)
                : "Bad request",
        };
      }
    }

    if (status >= 500) request.log.error({ err }, "Unhandled error");
    return reply.status(status).send(body);
  });

  await app.register(
    async (api) => {
      api.get(
        "/health",
        async (): Promise<HealthResponse> => ({
          ok: true,
          aiSuggestions: aiSuggestionsEnabled,
          voice: await voiceAvailable(),
          telegram: telegramInfo(),
          auth: { magicLink: mailerConfigured || !isProd, signup: env.ALLOW_SIGNUP === "true" },
        }),
      );
      await api.register(authRoutes);
      await api.register(folderRoutes);
      await api.register(ideaRoutes);
      await api.register(voiceRoutes);
      await api.register(notebookRoutes);
      await api.register(telegramRoutes);
      await api.register(agentRoutes);
      await api.register(integrationRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
