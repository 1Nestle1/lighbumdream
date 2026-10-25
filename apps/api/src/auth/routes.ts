import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  LoginBody,
  RequestMagicLinkBody,
  UpdateMeBody,
  VerifyMagicLinkBody,
  type MagicLinkResponse,
  type User,
} from "@lightbulb/shared";
import { env, isProd } from "../env.js";
import { db } from "../db/client.js";
import { magicLinks, users } from "../db/schema.js";
import { HttpError } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/tokens.js";
import { mailerConfigured, sendMagicLink } from "./mailer.js";
import { DUMMY_HASH, verifyPassword } from "./password.js";
import { createSession, destroySession, requireUser } from "./session.js";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/magic-link",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request): Promise<MagicLinkResponse> => {
      const { email, locale } = RequestMagicLinkBody.parse(request.body);
      // With sign-up closed, links only go to existing accounts. The answer is the same either
      // way, so the form doesn't reveal which emails have an account.
      if (env.ALLOW_SIGNUP === "false") {
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        if (!existing) return { ok: true };
      }
      const token = randomToken();
      await db.insert(magicLinks).values({
        email,
        locale,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      });
      const link = `${env.WEB_ORIGIN}/auth/verify?token=${token}`;
      await sendMagicLink(email, link, locale ?? "en", request.log);
      // Handing the link back is a dev convenience only; never in production.
      return !isProd && !mailerConfigured ? { ok: true, devLink: link } : { ok: true };
    },
  );

  app.post(
    "/auth/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply): Promise<{ user: User }> => {
      const { token } = VerifyMagicLinkBody.parse(request.body);
      // Single atomic update so a link can't be redeemed twice.
      const [link] = await db
        .update(magicLinks)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(magicLinks.tokenHash, sha256(token)),
            isNull(magicLinks.usedAt),
            gt(magicLinks.expiresAt, new Date()),
          ),
        )
        .returning({ email: magicLinks.email, locale: magicLinks.locale });
      if (!link) throw new HttpError(400, "invalid_link", "This link is invalid or has expired");
      if (env.ALLOW_SIGNUP === "false") {
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, link.email));
        if (!existing) throw new HttpError(403, "signup_closed", "New accounts can't be created right now");
      }

      // The language chosen on the sign-in page carries into the account.
      const [user] = await db
        .insert(users)
        .values({ email: link.email, ...(link.locale && { locale: link.locale }) })
        .onConflictDoUpdate({ target: users.email, set: link.locale ? { locale: link.locale } : { email: link.email } })
        .returning({ id: users.id, email: users.email, locale: users.locale });
      if (!user) throw new Error("User upsert returned nothing");

      await createSession(reply, user.id);
      return { user };
    },
  );

  // Email and password. Wrong email and wrong password get the same answer and take the same time.
  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (request: FastifyRequest) => request.ip },
      },
    },
    async (request, reply): Promise<{ user: User }> => {
      const { email, password } = LoginBody.parse(request.body);
      const [row] = await db
        .select({ id: users.id, email: users.email, locale: users.locale, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, email));
      const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
      if (!row?.passwordHash || !ok) throw new HttpError(401, "invalid_credentials", "Wrong email or password");
      await createSession(reply, row.id);
      return { user: { id: row.id, email: row.email, locale: row.locale } };
    },
  );

  app.get("/auth/me", async (request): Promise<{ user: User }> => ({ user: requireUser(request) }));

  app.patch("/auth/me", async (request): Promise<{ user: User }> => {
    const current = requireUser(request);
    const { locale } = UpdateMeBody.parse(request.body);
    const [user] = await db
      .update(users)
      .set({ locale })
      .where(eq(users.id, current.id))
      .returning({ id: users.id, email: users.email, locale: users.locale });
    return { user: user! };
  });

  app.post("/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });
}
