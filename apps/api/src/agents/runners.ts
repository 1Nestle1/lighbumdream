import { randomInt } from "node:crypto";
import { and, asc, count, eq, gt, isNull, lt } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type {
  AgentKind,
  PairingInfo,
  Runner,
  RunnerHelloResponse,
  RunnerPairPollResponse,
  RunnerPairResponse,
} from "@lightbulb/shared";
import { db } from "../db/client.js";
import { agentRunners, runnerPairings, users, type RunnerRow } from "../db/schema.js";
import { env } from "../env.js";
import { HttpError, notFound } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/tokens.js";
import { failRunsOfRunner, isOnline } from "./runs.js";

// Computers running the `lightbulb` CLI. Pairing follows the device flow that `gh auth login`
// and similar CLIs use: the CLI shows a short code, the user approves it on the website while
// signed in, and the CLI's poll then receives a long-lived token. Only token hashes are stored.

const PAIRING_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 5;
const MAX_RUNNERS = 10;
/** No vowels, no 0/O or 1/I: codes are easy to read aloud and never spell words. */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
export const RUNNER_TOKEN_PREFIX = "lbr_";

const userCode = () => {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
};

const toRunner = (row: RunnerRow): Runner => ({
  id: row.id,
  name: row.name,
  platform: row.platform,
  agents: row.agents,
  version: row.version,
  online: isOnline(row.lastSeenAt),
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

// ---------- Pairing ----------

export async function startPairing(name: string, platform: string): Promise<RunnerPairResponse> {
  await db.delete(runnerPairings).where(lt(runnerPairings.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const deviceCode = randomToken();
  for (let attempt = 0; ; attempt++) {
    const code = userCode();
    const inserted = await db
      .insert(runnerPairings)
      .values({
        deviceCodeHash: sha256(deviceCode),
        userCode: code,
        name,
        platform,
        expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      })
      .onConflictDoNothing({ target: runnerPairings.userCode })
      .returning({ id: runnerPairings.id });
    if (inserted.length) {
      return {
        deviceCode,
        userCode: code,
        verifyUrl: `${env.WEB_ORIGIN}/connect?code=${code}`,
        interval: POLL_INTERVAL_S,
        expiresIn: PAIRING_TTL_MS / 1000,
      };
    }
    if (attempt > 5) throw new Error("Could not allocate a pairing code");
  }
}

/** The CLI's poll. Once approved, issues the runner's token exactly once. */
export async function pollPairing(deviceCode: string): Promise<RunnerPairPollResponse> {
  const [pairing] = await db
    .select()
    .from(runnerPairings)
    .where(eq(runnerPairings.deviceCodeHash, sha256(deviceCode)));
  if (!pairing || pairing.consumedAt) return { status: "expired" };
  if (!pairing.approvedAt || !pairing.userId) {
    return pairing.expiresAt < new Date() ? { status: "expired" } : { status: "pending" };
  }
  const ownerId = pairing.userId;

  const token = RUNNER_TOKEN_PREFIX + randomToken();
  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(runnerPairings)
      .set({ consumedAt: new Date() })
      .where(and(eq(runnerPairings.id, pairing.id), isNull(runnerPairings.consumedAt)))
      .returning({ id: runnerPairings.id });
    if (!claimed) return null;
    const [runner] = await tx
      .insert(agentRunners)
      .values({ userId: ownerId, name: pairing.name, platform: pairing.platform, tokenHash: sha256(token) })
      .returning();
    const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, ownerId));
    return { runner: runner!, email: user?.email ?? "" };
  });
  if (!result) return { status: "expired" };
  return { status: "approved", token, runner: { id: result.runner.id, name: result.runner.name }, email: result.email };
}

async function pendingPairing(code: string) {
  const [pairing] = await db
    .select()
    .from(runnerPairings)
    .where(
      and(
        eq(runnerPairings.userCode, code),
        isNull(runnerPairings.approvedAt),
        gt(runnerPairings.expiresAt, new Date()),
      ),
    );
  if (!pairing) throw new HttpError(404, "code_invalid", "That code is wrong or has expired. Run `lightbulb login` again.");
  return pairing;
}

/** What the confirmation page shows before the user approves. */
export async function pairingInfo(code: string): Promise<PairingInfo> {
  const pairing = await pendingPairing(code);
  return {
    userCode: pairing.userCode,
    name: pairing.name,
    platform: pairing.platform,
    expiresAt: pairing.expiresAt.toISOString(),
  };
}

export async function approvePairing(userId: string, code: string): Promise<PairingInfo> {
  const pairing = await pendingPairing(code);
  const [owned] = await db.select({ n: count() }).from(agentRunners).where(eq(agentRunners.userId, userId));
  if ((owned?.n ?? 0) >= MAX_RUNNERS) {
    throw new HttpError(409, "limit_reached", `You can connect up to ${MAX_RUNNERS} computers. Remove one first.`);
  }
  const [approved] = await db
    .update(runnerPairings)
    .set({ userId, approvedAt: new Date() })
    .where(and(eq(runnerPairings.id, pairing.id), isNull(runnerPairings.approvedAt)))
    .returning();
  if (!approved) throw new HttpError(404, "code_invalid", "That code is wrong or has expired. Run `lightbulb login` again.");
  return {
    userCode: approved.userCode,
    name: approved.name,
    platform: approved.platform,
    expiresAt: approved.expiresAt.toISOString(),
  };
}

// ---------- The user's computers ----------

export async function listRunners(userId: string): Promise<Runner[]> {
  const rows = await db
    .select()
    .from(agentRunners)
    .where(eq(agentRunners.userId, userId))
    .orderBy(asc(agentRunners.createdAt));
  return rows.map(toRunner);
}

export async function renameRunner(userId: string, runnerId: string, name: string): Promise<Runner> {
  const [row] = await db
    .update(agentRunners)
    .set({ name })
    .where(and(eq(agentRunners.id, runnerId), eq(agentRunners.userId, userId)))
    .returning();
  if (!row) throw notFound("Computer");
  return toRunner(row);
}

/** Revokes the computer's token. Its unfinished runs fail so they don't wait forever. */
export async function removeRunner(userId: string, runnerId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: agentRunners.id })
      .from(agentRunners)
      .where(and(eq(agentRunners.id, runnerId), eq(agentRunners.userId, userId)));
    if (!row) throw notFound("Computer");
    await failRunsOfRunner(tx, row.id);
    await tx.delete(agentRunners).where(eq(agentRunners.id, row.id));
  });
}

// ---------- Runner authentication ----------

export interface RunnerAuth {
  id: string;
  userId: string;
  name: string;
}

const TOUCH_MS = 15_000;

/** Resolves the Bearer token of a CLI request; also records that the computer is online. */
export async function requireRunner(request: FastifyRequest): Promise<RunnerAuth> {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(RUNNER_TOKEN_PREFIX)) throw runnerUnauthorized();
  const [row] = await db
    .select({ id: agentRunners.id, userId: agentRunners.userId, name: agentRunners.name, lastSeenAt: agentRunners.lastSeenAt })
    .from(agentRunners)
    .where(eq(agentRunners.tokenHash, sha256(token)));
  if (!row) throw runnerUnauthorized();
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > TOUCH_MS) {
    await db.update(agentRunners).set({ lastSeenAt: new Date() }).where(eq(agentRunners.id, row.id));
  }
  return { id: row.id, userId: row.userId, name: row.name };
}

const runnerUnauthorized = () =>
  new HttpError(401, "runner_unauthorized", "This computer isn't connected. Run `lightbulb login`.");

export async function runnerHello(
  runner: RunnerAuth,
  info: { agents: AgentKind[]; version: string; platform: string },
): Promise<RunnerHelloResponse> {
  await db
    .update(agentRunners)
    .set({ agents: [...new Set(info.agents)], version: info.version, platform: info.platform, lastSeenAt: new Date() })
    .where(eq(agentRunners.id, runner.id));
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, runner.userId));
  return { runner: { id: runner.id, name: runner.name }, email: user?.email ?? "" };
}
