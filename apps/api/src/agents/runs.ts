import { and, asc, count, desc, eq, gt, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  ACTIVE_RUN_STATUSES,
  AGENT_LABELS,
  AGENT_LIMITS,
  AgentOptionsOutput,
  AgentPlanSchema,
  AgentResultOutput,
  type AgentKind,
  type AgentResult,
  type ChooseOptionBody,
  type PublishRunBody,
  type SendPromptBody,
  type IdeaRun,
  type RunEvent,
  type RunEventKind,
  type RunStage,
  type RunStatus,
  type RunnerAck,
  type RunnerTask,
  type StartRunBody,
} from "@lightbulb/shared";
import { db, type Db, type Tx } from "../db/client.js";
import {
  agentRunners,
  ideaFiles,
  ideaNotes,
  ideaRuns,
  ideaSteps,
  ideas,
  runEvents,
  users,
  type IdeaRunRow,
} from "../db/schema.js";
import { env } from "../env.js";
import { HttpError, notFound } from "../lib/http.js";
import { publishProject } from "../integrations/github.js";
import { hasIntegration, useIntegration } from "../integrations/service.js";
import { addFile, deleteFile, getFile } from "../notebook/service.js";
import { readFileBuffer } from "../storage/files.js";
import { isUniqueViolation } from "../lib/pg.js";
import { CLOUD_QUEUE, emitRunUpdate, signalWork } from "./signals.js";
import { projectSlug } from "./slug.js";

// The run state machine. Users move a run between stages (choose, revise, approve); agents
// claim the *_pending stages and "building" under a lease and report back. The only way into
// "building" is approve(), and it names the plan version the user saw.

/** The server's own key can run cloud agents for everyone (within the daily limit). */
export const cloudAvailable = Boolean(env.ANTHROPIC_API_KEY) && env.CLOUD_AGENTS === "true";

/** Cloud runs work with the server's key, or with the user's own Anthropic key. */
export async function cloudFor(userId: string): Promise<{ available: boolean; ownKey: boolean }> {
  const ownKey = await hasIntegration(userId, "anthropic");
  return { available: env.CLOUD_AGENTS === "true" && (cloudAvailable || ownKey), ownKey };
}

const ONLINE_MS = 60_000;
export const isOnline = (lastSeenAt: Date | null) =>
  lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < ONLINE_MS;

const STAGE: Partial<Record<RunStatus, RunStage>> = {
  options_pending: "options",
  plan_pending: "plan",
  building: "build",
};
const PENDING: Record<RunStage, RunStatus> = {
  options: "options_pending",
  plan: "plan_pending",
  build: "building",
  prompt: "building",
};

/** The stage an agent works on: prompt runs are "building" too, but carry out the user's prompt. */
const stageOf = (row: Pick<IdeaRunRow, "status" | "kind">): RunStage | undefined =>
  row.kind === "prompt" && row.status === "building" ? "prompt" : STAGE[row.status];
const WORK_STATUSES = ["options_pending", "plan_pending", "building"] as const satisfies RunStatus[];
/** Claims of one stage before it fails instead of being handed out again. */
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = { runner: 90, cloud: 180 } as const;

/** Who works on a run: a user's computer, or this server's cloud worker. */
export type Owner = { kind: "runner"; runnerId: string } | { kind: "cloud" };

type Conn = Db | Tx;

/** Clears what belonged to the previous stage when a run gets new work. */
const FRESH_STAGE = { leaseId: null, leaseUntil: null, attempts: 0, progress: [], error: null };

const queueOf = (row: IdeaRunRow) => (row.target === "cloud" ? CLOUD_QUEUE : (row.runnerId ?? ""));

const leaseUntil = (owner: Owner) => sql`now() + make_interval(secs => ${LEASE_SECONDS[owner.kind]})`;

const ownerFilter = (owner: Owner): SQL =>
  owner.kind === "cloud"
    ? sql`${ideaRuns.target} = 'cloud'`
    : sql`${ideaRuns.target} = 'local' and ${ideaRuns.runnerId} = ${owner.runnerId}`;

// ---------- Views ----------

type RunnerRef = { id: string; name: string; lastSeenAt: Date | null } | null;

function toRun(row: IdeaRunRow, runner: RunnerRef, events: RunEvent[]): IdeaRun {
  return {
    id: row.id,
    ideaId: row.ideaId,
    target: row.target,
    runner: runner ? { id: runner.id, name: runner.name, online: isOnline(runner.lastSeenAt) } : null,
    agent: row.agent,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    options: row.options,
    choice: row.choice,
    plan: row.plan,
    planVersion: row.planVersion,
    revision: row.revision,
    result: row.result,
    error: row.error,
    progress: row.progress,
    working: row.leaseId !== null && row.leaseUntil !== null && row.leaseUntil > new Date(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events,
  };
}

async function selectRuns(where: SQL | undefined, limit: number): Promise<IdeaRun[]> {
  const rows = await db
    .select({
      run: ideaRuns,
      runner: { id: agentRunners.id, name: agentRunners.name, lastSeenAt: agentRunners.lastSeenAt },
    })
    .from(ideaRuns)
    .leftJoin(agentRunners, eq(agentRunners.id, ideaRuns.runnerId))
    .where(where)
    .orderBy(desc(ideaRuns.createdAt))
    .limit(limit);
  if (!rows.length) return [];

  const events = await db
    .select()
    .from(runEvents)
    .where(
      inArray(
        runEvents.runId,
        rows.map((r) => r.run.id),
      ),
    )
    .orderBy(asc(runEvents.createdAt));
  const byRun = new Map<string, RunEvent[]>();
  for (const e of events) {
    const list = byRun.get(e.runId) ?? [];
    list.push({ id: e.id, kind: e.kind, text: e.text, createdAt: e.createdAt.toISOString() });
    byRun.set(e.runId, list);
  }
  return rows.map(({ run, runner }) => toRun(run, runner, byRun.get(run.id) ?? []));
}

/** The latest run of each idea, without history: what the projects board shows. */
export async function listRunsForIdeas(userId: string, ideaIds: string[]): Promise<Map<string, Omit<IdeaRun, "events">>> {
  if (!ideaIds.length) return new Map();
  const rows = await db
    .selectDistinctOn([ideaRuns.ideaId], {
      run: ideaRuns,
      runner: { id: agentRunners.id, name: agentRunners.name, lastSeenAt: agentRunners.lastSeenAt },
    })
    .from(ideaRuns)
    .leftJoin(agentRunners, eq(agentRunners.id, ideaRuns.runnerId))
    .where(and(eq(ideaRuns.userId, userId), inArray(ideaRuns.ideaId, ideaIds)))
    .orderBy(ideaRuns.ideaId, desc(ideaRuns.createdAt));
  return new Map(
    rows.map(({ run, runner }) => {
      const { events: _events, ...view } = toRun(run, runner, []);
      return [run.ideaId, view];
    }),
  );
}

async function getRun(userId: string, runId: string): Promise<IdeaRun> {
  const [run] = await selectRuns(and(eq(ideaRuns.id, runId), eq(ideaRuns.userId, userId)), 1);
  if (!run) throw notFound("Run");
  return run;
}

async function loadRun(userId: string, runId: string): Promise<IdeaRunRow> {
  const [row] = await db
    .select()
    .from(ideaRuns)
    .where(and(eq(ideaRuns.id, runId), eq(ideaRuns.userId, userId)));
  if (!row) throw notFound("Run");
  return row;
}

async function addEvent(conn: Conn, row: IdeaRunRow, kind: RunEventKind, text: string | null) {
  await conn.insert(runEvents).values({ runId: row.id, userId: row.userId, kind, text });
}

/** The latest runs of an idea, newest first. */
export async function listRuns(userId: string, ideaId: string): Promise<IdeaRun[]> {
  const [idea] = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)));
  if (!idea) throw notFound("Idea");
  return selectRuns(and(eq(ideaRuns.ideaId, ideaId), eq(ideaRuns.userId, userId)), 10);
}

// ---------- User actions ----------

export async function startRun(userId: string, ideaId: string, body: StartRunBody): Promise<IdeaRun> {
  const [idea] = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)));
  if (!idea) throw notFound("Idea");

  let runnerId: string | null = null;
  let agent: AgentKind | "cloud" = "cloud";
  let label = "cloud";
  if (body.target === "cloud") {
    if (!(await cloudFor(userId)).available) {
      throw new HttpError(503, "cloud_unavailable", "Connect your Anthropic API key under Integrations to use the cloud");
    }
  } else {
    const [runner] = await db
      .select()
      .from(agentRunners)
      .where(and(eq(agentRunners.id, body.runnerId), eq(agentRunners.userId, userId)));
    if (!runner) throw notFound("Computer");
    if (!runner.agents.includes(body.agent)) {
      throw new HttpError(400, "agent_unavailable", `${AGENT_LABELS[body.agent]} wasn't found on ${runner.name}`);
    }
    runnerId = runner.id;
    agent = body.agent;
    label = `${AGENT_LABELS[body.agent]} · ${runner.name}`;
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ideaRuns)
        .values({ userId, ideaId, target: body.target, runnerId, agent, status: "options_pending" })
        .returning();
      await addEvent(tx, row!, "started", label);
      return row!;
    });
    signalWork(queueOf(row));
    return getRun(userId, row.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "run_active", "This idea is already with an agent");
    throw err;
  }
}

/**
 * Sends the user's own instruction to one of their computers, to carry on with the project.
 * It runs at once (the prompt is the user's decision; there is no plan to approve).
 */
export async function sendPrompt(userId: string, ideaId: string, body: SendPromptBody): Promise<IdeaRun> {
  const [idea] = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)));
  if (!idea) throw notFound("Idea");
  const [runner] = await db
    .select()
    .from(agentRunners)
    .where(and(eq(agentRunners.id, body.runnerId), eq(agentRunners.userId, userId)));
  if (!runner) throw notFound("Computer");
  if (!runner.agents.includes(body.agent)) {
    throw new HttpError(400, "agent_unavailable", `${AGENT_LABELS[body.agent]} wasn't found on ${runner.name}`);
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ideaRuns)
        .values({
          userId,
          ideaId,
          target: "local",
          runnerId: runner.id,
          agent: body.agent,
          kind: "prompt",
          prompt: body.prompt,
          status: "building",
          approvedAt: new Date(),
        })
        .returning();
      await addEvent(tx, row!, "prompted", body.prompt.slice(0, 300));
      return row!;
    });
    signalWork(queueOf(row));
    return getRun(userId, row.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "run_active", "This project is already busy with an agent");
    throw err;
  }
}

/** Moves a run from one of `from` to a new state, or explains why it can't. */
async function transition(
  userId: string,
  runId: string,
  from: readonly RunStatus[],
  patch: Partial<typeof ideaRuns.$inferInsert>,
  event: { kind: RunEventKind; text: string | null },
  extra?: SQL,
): Promise<IdeaRun> {
  let row: IdeaRunRow | null;
  try {
    row = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(ideaRuns)
        .set(patch)
        .where(and(eq(ideaRuns.id, runId), eq(ideaRuns.userId, userId), inArray(ideaRuns.status, [...from]), extra))
        .returning();
      if (!row) return null;
      await addEvent(tx, row, event.kind, event.text);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "run_active", "This idea is already with an agent");
    throw err;
  }
  if (!row) {
    await loadRun(userId, runId); // 404 when it isn't theirs
    throw new HttpError(409, "run_moved_on", "This step has already moved on. Refresh to see where it is.");
  }
  signalWork(queueOf(row));
  return getRun(userId, row.id);
}

export async function chooseOption(userId: string, runId: string, body: ChooseOptionBody): Promise<IdeaRun> {
  const row = await loadRun(userId, runId);
  const option = row.options?.[body.index];
  if (!option) throw new HttpError(400, "invalid_option", "Pick one of the offered options");
  return transition(
    userId,
    runId,
    ["options_ready", "plan_ready"],
    {
      status: "plan_pending",
      choice: { index: body.index, title: option.title, comment: body.comment || null },
      plan: null,
      revision: null,
      ...FRESH_STAGE,
    },
    { kind: "chose", text: option.title },
  );
}

export async function reviseRun(userId: string, runId: string, comment: string): Promise<IdeaRun> {
  return transition(
    userId,
    runId,
    ["plan_ready"],
    { status: "plan_pending", revision: comment, ...FRESH_STAGE },
    { kind: "revise", text: comment },
  );
}

/**
 * Cloud builds on the server's key cost the server's money, so each user gets a few per day
 * (approvals and build retries). Builds on the user's own key have no such limit.
 */
async function checkCloudQuota(userId: string) {
  if (await hasIntegration(userId, "anthropic")) return;
  const [used] = await db
    .select({ n: count() })
    .from(runEvents)
    .innerJoin(ideaRuns, eq(ideaRuns.id, runEvents.runId))
    .where(
      and(
        eq(runEvents.userId, userId),
        eq(ideaRuns.target, "cloud"),
        or(eq(runEvents.kind, "approved"), and(eq(runEvents.kind, "retried"), eq(runEvents.text, "build"))),
        gt(runEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  if ((used?.n ?? 0) >= env.CLOUD_BUILDS_PER_DAY) {
    throw new HttpError(429, "cloud_limit", "You've used today's cloud builds. Try again tomorrow or use your computer.");
  }
}

export async function approveRun(userId: string, runId: string, planVersion: number): Promise<IdeaRun> {
  const row = await loadRun(userId, runId);
  if (row.target === "cloud" && row.status === "plan_ready") await checkCloudQuota(userId);
  return transition(
    userId,
    runId,
    ["plan_ready"],
    { status: "building", approvedAt: new Date(), cloudSessionId: null, ...FRESH_STAGE },
    { kind: "approved", text: row.plan?.title ?? null },
    // Approve exactly the plan the user read, never one that replaced it meanwhile.
    eq(ideaRuns.planVersion, planVersion),
  );
}

export async function retryRun(userId: string, runId: string): Promise<IdeaRun> {
  const row = await loadRun(userId, runId);
  if (row.status !== "failed" || !row.error) {
    throw new HttpError(409, "run_moved_on", "This step has already moved on. Refresh to see where it is.");
  }
  if (row.target === "local" && !row.runnerId) {
    throw new HttpError(409, "no_runner", "The computer for this run was removed. Start a new run.");
  }
  const stage = row.error.stage;
  if (stage === "build" && row.target === "cloud") await checkCloudQuota(userId);
  return transition(
    userId,
    runId,
    ["failed"],
    { status: PENDING[stage], finishedAt: null, cloudSessionId: null, ...FRESH_STAGE },
    { kind: "retried", text: stage },
  );
}

export async function cancelRun(userId: string, runId: string): Promise<IdeaRun> {
  return transition(
    userId,
    runId,
    ACTIVE_RUN_STATUSES,
    { status: "cancelled", leaseId: null, leaseUntil: null, finishedAt: new Date() },
    { kind: "cancelled", text: null },
  );
}

/** Fails a run's active local work when its computer is removed. */
export async function failRunsOfRunner(conn: Conn, runnerId: string) {
  const rows = await conn
    .select()
    .from(ideaRuns)
    .where(and(eq(ideaRuns.runnerId, runnerId), inArray(ideaRuns.status, [...ACTIVE_RUN_STATUSES])));
  for (const row of rows) {
    const stage = stageOf(row) ?? (row.status === "options_ready" ? "options" : "plan");
    const message = "The computer for this run was removed.";
    await conn
      .update(ideaRuns)
      .set({ status: "failed", error: { stage, message, code: "offline" }, leaseId: null, leaseUntil: null })
      .where(eq(ideaRuns.id, row.id));
    await addEvent(conn, row, "failed", message);
  }
}

// ---------- Agent side: claim, report ----------

/** Hands the oldest waiting task to an agent under a lease. Stale leases are claimable again. */
export async function claimRun(owner: Owner): Promise<IdeaRunRow | null> {
  for (let i = 0; i < 5; i++) {
    const claimed = await db.execute<{ id: string }>(sql`
      update ${ideaRuns}
      set lease_id = gen_random_uuid(), lease_until = ${leaseUntil(owner)}, attempts = attempts + 1, updated_at = now()
      where id = (
        select id from ${ideaRuns}
        where ${ownerFilter(owner)}
          and status in ('options_pending', 'plan_pending', 'building')
          and (lease_until is null or lease_until < now())
        order by updated_at
        limit 1
        for update skip locked
      )
      returning id`);
    const id = claimed[0]?.id;
    if (!id) return null;
    const [row] = await db.select().from(ideaRuns).where(eq(ideaRuns.id, id));
    if (!row) continue;
    if (row.attempts > MAX_ATTEMPTS) {
      await failRun(row, "The agent stopped responding several times in a row.", "timeout");
      continue;
    }
    return row;
  }
  return null;
}

/** Everything an agent needs for the run's current stage. */
export async function buildTask(row: IdeaRunRow): Promise<RunnerTask> {
  const stage = stageOf(row);
  if (!stage || !row.leaseId) throw new Error(`Run ${row.id} has no claimed stage`);
  const [idea] = await db
    .select({ id: ideas.id, title: ideas.title, body: ideas.body, projectPath: ideas.projectPath, locale: users.locale })
    .from(ideas)
    .innerJoin(users, eq(users.id, ideas.userId))
    .where(eq(ideas.id, row.ideaId));
  if (!idea) throw notFound("Idea");

  const [steps, notes, files] = await Promise.all([
    db
      .select({ text: ideaSteps.text, doneAt: ideaSteps.doneAt })
      .from(ideaSteps)
      .where(eq(ideaSteps.ideaId, idea.id))
      .orderBy(asc(ideaSteps.position), asc(ideaSteps.createdAt)),
    db
      .select({ text: ideaNotes.text })
      .from(ideaNotes)
      .where(eq(ideaNotes.ideaId, idea.id))
      .orderBy(desc(ideaNotes.createdAt))
      .limit(30),
    db
      .select({ id: ideaFiles.id, name: ideaFiles.name, mime: ideaFiles.mime, sizeBytes: ideaFiles.sizeBytes })
      .from(ideaFiles)
      .where(eq(ideaFiles.ideaId, idea.id))
      .orderBy(asc(ideaFiles.createdAt)),
  ]);

  const option = row.choice ? row.options?.[row.choice.index] : undefined;
  const archive = [...files].reverse().find((f) => f.name.toLowerCase().endsWith(".zip")) ?? null;
  const history = await db
    .select({ prompt: ideaRuns.prompt, result: ideaRuns.result, error: ideaRuns.error, at: ideaRuns.createdAt })
    .from(ideaRuns)
    .where(and(eq(ideaRuns.ideaId, idea.id), eq(ideaRuns.kind, "prompt"), inArray(ideaRuns.status, ["done", "failed"])))
    .orderBy(desc(ideaRuns.createdAt))
    .limit(5);
  return {
    runId: row.id,
    leaseId: row.leaseId,
    stage,
    agent: row.agent === "cloud" ? "claude" : row.agent,
    locale: idea.locale,
    idea: {
      id: idea.id,
      title: idea.title,
      body: idea.body,
      steps: steps.map((s) => ({ text: s.text, done: s.doneAt !== null })),
      notes: notes.map((n) => n.text),
      files,
    },
    choice: row.choice && option ? { ...row.choice, option } : null,
    plan: row.plan,
    revision: row.revision,
    projectSlug: projectSlug(idea.title, idea.id),
    prompt: row.prompt,
    projectPath: idea.projectPath,
    archive: archive ? { id: archive.id, name: archive.name, sizeBytes: archive.sizeBytes } : null,
    history: history.reverse().map((h) => ({
      prompt: h.prompt ?? "",
      summary: h.result?.summary ?? (h.error ? `Stopped: ${h.error.message}` : null),
      at: h.at.toISOString(),
    })),
  };
}

const STOP: RunnerAck = { ok: false, cancelled: true };

/** The run, if `leaseId` still holds its current stage; null tells the agent to stop. */
async function heldRun(owner: Owner, runId: string, leaseId: string): Promise<IdeaRunRow | null> {
  const [row] = await db
    .select()
    .from(ideaRuns)
    .where(and(eq(ideaRuns.id, runId), ownerFilter(owner)));
  if (!row) throw notFound("Run");
  if (row.leaseId !== leaseId || !stageOf(row)) return null;
  return row;
}

async function failRun(row: IdeaRunRow, message: string, code: string) {
  const stage = stageOf(row);
  if (!stage) return;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ideaRuns)
      .set({ status: "failed", error: { stage, message, code }, leaseId: null, leaseUntil: null })
      .where(and(eq(ideaRuns.id, row.id), eq(ideaRuns.status, row.status)))
      .returning();
    if (updated) await addEvent(tx, updated, "failed", message);
    return updated;
  }).then((updated) => updated && emitRunUpdate(row.id));
}

async function completeStage(
  row: IdeaRunRow,
  leaseId: string,
  patch: Partial<typeof ideaRuns.$inferInsert>,
  event: { kind: RunEventKind; text: string | null },
): Promise<RunnerAck> {
  const done = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ideaRuns)
      .set({ ...patch, leaseId: null, leaseUntil: null, attempts: 0 })
      .where(and(eq(ideaRuns.id, row.id), eq(ideaRuns.leaseId, leaseId), eq(ideaRuns.status, row.status)))
      .returning();
    if (!updated) return false;
    await addEvent(tx, updated, event.kind, event.text);
    return true;
  });
  if (done) emitRunUpdate(row.id);
  return done ? { ok: true, cancelled: false } : STOP;
}

/** A run with what a notification needs: the idea's title and how to reach its owner. */
export async function runForNotice(runId: string) {
  const [row] = await db
    .select({
      run: ideaRuns,
      ideaTitle: ideas.title,
      telegramId: users.telegramId,
      locale: users.locale,
      runnerName: agentRunners.name,
    })
    .from(ideaRuns)
    .innerJoin(ideas, eq(ideas.id, ideaRuns.ideaId))
    .innerJoin(users, eq(users.id, ideaRuns.userId))
    .leftJoin(agentRunners, eq(agentRunners.id, ideaRuns.runnerId))
    .where(eq(ideaRuns.id, runId));
  return row ?? null;
}

const wrongStage = () => new HttpError(409, "wrong_stage", "The run isn't at that stage");

export async function reportOptions(owner: Owner, runId: string, leaseId: string, output: unknown): Promise<RunnerAck> {
  const row = await heldRun(owner, runId, leaseId);
  if (!row) return STOP;
  if (row.status !== "options_pending") throw wrongStage();
  const parsed = AgentOptionsOutput.safeParse(output);
  if (!parsed.success) {
    await failRun(row, "The agent's options came back in an unexpected format.", "invalid_output");
    return { ok: false, cancelled: false };
  }
  return completeStage(row, leaseId, { status: "options_ready", options: parsed.data.options }, { kind: "options", text: null });
}

export async function reportPlan(owner: Owner, runId: string, leaseId: string, output: unknown): Promise<RunnerAck> {
  const row = await heldRun(owner, runId, leaseId);
  if (!row) return STOP;
  if (row.status !== "plan_pending") throw wrongStage();
  const parsed = AgentPlanSchema.safeParse(output);
  if (!parsed.success) {
    await failRun(row, "The agent's plan came back in an unexpected format.", "invalid_output");
    return { ok: false, cancelled: false };
  }
  return completeStage(
    row,
    leaseId,
    { status: "plan_ready", plan: parsed.data, planVersion: row.planVersion + 1, revision: null },
    { kind: "plan", text: parsed.data.title },
  );
}

export async function reportResult(
  owner: Owner,
  runId: string,
  leaseId: string,
  output: unknown,
  extra: { location: string | null; files?: AgentResult["files"]; archiveFileId?: string | null },
): Promise<RunnerAck> {
  const row = await heldRun(owner, runId, leaseId);
  if (!row) return STOP;
  if (row.status !== "building") throw wrongStage();
  const files = [...(extra.files ?? [])];
  if (extra.archiveFileId) {
    const [archive] = await db
      .select({ id: ideaFiles.id, name: ideaFiles.name })
      .from(ideaFiles)
      .where(and(eq(ideaFiles.id, extra.archiveFileId), eq(ideaFiles.ideaId, row.ideaId)));
    if (archive) files.push(archive);
  }
  const parsed = AgentResultOutput.safeParse(output);
  // A build that finished is worth keeping even when its summary isn't the JSON we asked for.
  const summary = parsed.success
    ? parsed.data.summary
    : typeof output === "string" && output.trim()
      ? output.trim().slice(0, 4000)
      : "The agent finished without describing the result.";
  const result: AgentResult = {
    summary,
    followUps: parsed.success ? parsed.data.followUps.slice(0, AGENT_LIMITS.followUps) : [],
    location: extra.location,
    files,
  };
  return completeStage(row, leaseId, { status: "done", result, finishedAt: new Date() }, { kind: "done", text: null });
}

export async function reportFailure(
  owner: Owner,
  runId: string,
  leaseId: string,
  message: string,
  code: string,
): Promise<RunnerAck> {
  const row = await heldRun(owner, runId, leaseId);
  if (!row) return STOP;
  await failRun(row, message.trim().slice(0, 2000) || "The agent failed.", code);
  return { ok: true, cancelled: false };
}

export async function reportProgress(owner: Owner, runId: string, leaseId: string, lines: string[]): Promise<RunnerAck> {
  const row = await heldRun(owner, runId, leaseId);
  if (!row) return STOP;
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim().slice(0, 300)).filter(Boolean);
  const [updated] = await db
    .update(ideaRuns)
    .set({
      progress: [...row.progress, ...clean].slice(-AGENT_LIMITS.progressLines),
      leaseUntil: leaseUntil(owner),
    })
    .where(and(eq(ideaRuns.id, row.id), eq(ideaRuns.leaseId, leaseId)))
    .returning({ id: ideaRuns.id });
  return updated ? { ok: true, cancelled: false } : STOP;
}

/** Extends the lease while an agent works. A stopped answer means the user cancelled or it moved on. */
export async function heartbeat(owner: Owner, runId: string, leaseId: string): Promise<RunnerAck> {
  const [updated] = await db
    .update(ideaRuns)
    .set({ leaseUntil: leaseUntil(owner) })
    .where(
      and(
        eq(ideaRuns.id, runId),
        eq(ideaRuns.leaseId, leaseId),
        inArray(ideaRuns.status, [...WORK_STATUSES]),
        ownerFilter(owner),
      ),
    )
    .returning({ id: ideaRuns.id });
  return updated ? { ok: true, cancelled: false } : STOP;
}

/** An attachment of an idea this runner is working on right now. */
export async function runnerFile(runnerId: string, fileId: string) {
  const [row] = await db
    .select({ file: ideaFiles })
    .from(ideaFiles)
    .innerJoin(
      ideaRuns,
      and(
        eq(ideaRuns.ideaId, ideaFiles.ideaId),
        eq(ideaRuns.runnerId, runnerId),
        inArray(ideaRuns.status, [...WORK_STATUSES]),
        isNotNull(ideaRuns.leaseId),
      ),
    )
    .where(eq(ideaFiles.id, fileId))
    .limit(1);
  if (!row) throw notFound("File");
  return row.file;
}

// ---------- Project archives and publishing ----------

/** Saves the project zip a runner uploads before reporting its build result. */
export async function attachArchive(runnerId: string, runId: string, leaseId: string, data: Buffer) {
  const row = await heldRun({ kind: "runner", runnerId }, runId, leaseId);
  if (!row || row.status !== "building") throw new HttpError(409, "wrong_stage", "The run isn't building");
  const [idea] = await db.select({ title: ideas.title }).from(ideas).where(eq(ideas.id, row.ideaId));
  const name = `${projectSlug(idea?.title ?? "project", row.ideaId)}.zip`;
  const saved = await addFile(row.userId, row.ideaId, { name, mime: "application/zip", data });
  // Keep one current copy of the project: drop the zips older runs saved under the same name.
  const older = await db
    .select({ id: ideaFiles.id })
    .from(ideaFiles)
    .where(and(eq(ideaFiles.ideaId, row.ideaId), eq(ideaFiles.name, name), ne(ideaFiles.id, saved.id)));
  for (const file of older) await deleteFile(row.userId, file.id).catch(() => {});
  return saved;
}

/** Publishes a finished run's project zip to a new GitHub repository. */
export async function publishRun(userId: string, runId: string, body: PublishRunBody): Promise<IdeaRun> {
  const row = await loadRun(userId, runId);
  if (row.status !== "done" || !row.result) throw new HttpError(409, "run_moved_on", "Only a finished build can be published");
  if (row.result.repo) throw new HttpError(409, "already_published", "This build is already on GitHub");

  const zips = row.result.files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
  const archive = zips.find((f) => f.name === "project.zip") ?? zips[0];
  if (!archive) throw new HttpError(422, "no_project_zip", "This build has no project zip to publish");
  const github = await useIntegration(userId, "github");
  if (!github) throw new HttpError(400, "github_not_connected", "Connect GitHub under Integrations first");

  const file = await getFile(userId, archive.id);
  const zip = await readFileBuffer(file.storageKey);
  const [idea] = await db.select({ title: ideas.title }).from(ideas).where(eq(ideas.id, row.ideaId));
  const name = body.name ?? (projectSlug(idea?.title ?? "", row.ideaId).replace(/-[0-9a-f]{6}$/, "") || "lightbulb-project");
  const description = (row.plan?.title ?? idea?.title ?? "Built with Lightbulb").slice(0, 300);

  const repo = await publishProject(github.secret, { name, description, private: body.private ?? true }, zip);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ideaRuns)
      .set({ result: { ...row.result!, repo } })
      .where(eq(ideaRuns.id, row.id))
      .returning();
    await addEvent(tx, updated!, "published", repo.fullName);
  });
  return getRun(userId, row.id);
}
