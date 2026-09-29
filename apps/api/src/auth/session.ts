import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@lightbulb/shared";
import { isProd } from "../env.js";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/tokens.js";
import { unauthorized } from "../lib/http.js";

export const SESSION_COOKIE = "lb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    expires: expiresAt,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Resolves the session cookie into `request.user` on every request. */
export function registerSession(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await db
      .select({ id: users.id, email: users.email, locale: users.locale })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    request.user = row ?? null;
  });
}

/** Returns the signed-in user or throws 401. Every data query is scoped by this id. */
export function requireUser(request: FastifyRequest): User {
  if (!request.user) throw unauthorized();
  return request.user;
}
