import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { LIMITS, type AgentResult, type RunnerTask } from "@lightbulb/shared";
import {
  CLOUD_OUTPUT_DIR,
  CLOUD_RESULT_FILE,
  OPTIONS_SCHEMA,
  PLAN_SCHEMA,
  buildPrompt,
  optionsPrompt,
  parseJsonLoose,
  planPrompt,
  type PromptContext,
} from "@lightbulb/shared/protocol";
import { db } from "../db/client.js";
import { appState, ideaRuns, type IdeaRunRow } from "../db/schema.js";
import { env } from "../env.js";
import { addFile, classifyUpload } from "../notebook/service.js";
import { supportsModernParams } from "../suggest/claude.js";
import {
  buildTask,
  claimRun,
  cloudAvailable,
  heartbeat,
  reportFailure,
  reportOptions,
  reportPlan,
  reportProgress,
  reportResult,
  type Owner,
} from "./runs.js";
import { CLOUD_QUEUE, waitForWork } from "./signals.js";

// The cloud side of the agent loop, run inside the API process. Options and plans are single
// structured-output calls to the Claude API. Approved builds run on Claude Managed Agents: a
// hosted agent in its own sandbox, capped by a session budget, whose deliverables are saved to
// the idea's files when it finishes. Needs ANTHROPIC_API_KEY.

const OWNER: Owner = { kind: "cloud" };
const CONTEXT: PromptContext = { place: "cloud", attachmentsDir: null };
const THINK_TIMEOUT_MS = 6 * 60 * 1000;
const HEARTBEAT_MS = 30_000;
const TICK_MS = 5_000;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 }));

class CloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Options and plans ----------

const SYSTEM =
  "You help people turn ideas from their idea bank into real projects. You are practical and specific, and you answer only in the requested JSON format.";

async function think(prompt: string, schema: Record<string, unknown>, effort: "medium" | "high", signal: AbortSignal) {
  const modern = supportsModernParams(env.AGENT_MODEL);
  const stream = anthropic().beta.messages.stream(
    {
      model: env.AGENT_MODEL,
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      ...(modern && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      output_config: { ...(modern && { effort }), format: { type: "json_schema", schema } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    },
    { signal },
  );
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new CloudError("The model declined to work on this idea.", "failed");
  if (message.stop_reason === "max_tokens") throw new CloudError("The answer was too long and got cut off.", "invalid_output");
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new CloudError("The model's answer wasn't valid JSON.", "invalid_output");
  }
}

// ---------- Builds ----------

const BUILDER_SYSTEM = `You build first working versions of people's ideas, alone, in a cloud sandbox with internet access.
Nobody can answer questions during the run, so make sensible choices and write them down.
Keep the work in /workspace. Deliverables go to ${CLOUD_OUTPUT_DIR}/, which is collected when you finish.
Never use real payment details or personal credentials; read secrets from environment variables and document them.`;

/** Bump when BUILDER_SYSTEM or the toolset changes, so a fresh agent gets provisioned. */
const BUILDER_REVISION = 1;
const BUILDER_KEY = "cloud_builder";

interface BuilderState {
  agentId: string;
  agentVersion: number;
  environmentId: string;
  model: string;
  revision: number;
}

let builderPromise: Promise<BuilderState> | null = null;

/** The Managed Agents agent and environment, created once and remembered in app_state. */
function builder(): Promise<BuilderState> {
  builderPromise ??= (async () => {
    const [row] = await db.select().from(appState).where(eq(appState.key, BUILDER_KEY));
    const saved = row?.value as BuilderState | undefined;
    if (saved && saved.model === env.AGENT_MODEL && saved.revision === BUILDER_REVISION) return saved;

    const environmentId =
      saved?.environmentId ??
      (
        await anthropic().beta.environments.create({
          name: "lightbulb-builds",
          config: { type: "cloud", networking: { type: "unrestricted" } },
        })
      ).id;
    const agent = await anthropic().beta.agents.create({
      name: "Lightbulb builder",
      model: env.AGENT_MODEL,
      system: BUILDER_SYSTEM,
      tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
    });
    const state: BuilderState = {
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId,
      model: env.AGENT_MODEL,
      revision: BUILDER_REVISION,
    };
    await db
      .insert(appState)
      .values({ key: BUILDER_KEY, value: state })
      .onConflictDoUpdate({ target: appState.key, set: { value: state } });
    return state;
  })().catch((err) => {
    builderPromise = null;
    throw err;
  });
  return builderPromise;
}

const RUBRIC = `- ${CLOUD_OUTPUT_DIR}/README.md exists and explains what was built, how to run it and what is left to do.
- ${CLOUD_OUTPUT_DIR}/${CLOUD_RESULT_FILE} exists and is a JSON object with "summary" (string) and "followUps" (array of at most 5 short strings).
- If the plan involves code, ${CLOUD_OUTPUT_DIR}/project.zip holds the complete project, and it builds or runs as the README says.
- Every step of the approved plan is done, or the README says why it was changed or skipped.
- No real credentials, payment details or personal data are used; secrets come from environment variables.
- No placeholder text or stubbed-out features remain where the plan promised working functionality.`;

function describeTool(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const detail = ["command", "file_path", "path", "url", "query"]
    .map((key) => fields[key])
    .find((value): value is string => typeof value === "string");
  return detail ? `${name}: ${detail}` : name;
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim())?.trim() ?? "";

/** Streams the session until the agent finishes; returns its last message. */
async function follow(
  sessionId: string,
  kickoff: boolean,
  task: RunnerTask,
  progress: string[],
  signal: AbortSignal,
): Promise<string> {
  let lastText = "";
  for (let reconnects = 0; reconnects < 20; reconnects++) {
    // Stream first, then send: the stream only carries events that happen after it opens.
    const stream = await anthropic().beta.sessions.events.stream(sessionId, {}, { signal });
    if (kickoff && reconnects === 0) {
      await anthropic().beta.sessions.events.send(sessionId, {
        events: [
          {
            type: "user.define_outcome",
            description: buildPrompt(task, CONTEXT),
            rubric: { type: "text", content: RUBRIC },
            max_iterations: 3,
          },
        ],
      });
    }

    for await (const event of stream) {
      switch (event.type) {
        case "agent.message": {
          const text = event.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("\n")
            .trim();
          if (text) {
            lastText = text;
            progress.push(firstLine(text));
          }
          break;
        }
        case "agent.tool_use":
          progress.push(describeTool(event.name, event.input));
          break;
        case "span.outcome_evaluation_end":
          progress.push(`Review ${event.iteration + 1}: ${event.result.replace(/_/g, " ")}`);
          break;
        case "session.status_idle":
          switch (event.stop_reason.type) {
            case "end_turn":
              return lastText;
            case "budget_reached":
              throw new CloudError(`The build reached its $${env.CLOUD_BUILD_BUDGET_USD} spending cap.`, "budget");
            case "retries_exhausted":
              throw new CloudError("The cloud agent kept hitting errors and stopped.", "failed");
            default:
              throw new CloudError("The cloud agent stopped to wait for input, which this run can't give.", "failed");
          }
        case "session.status_terminated":
          throw new CloudError("The cloud session ended unexpectedly.", "failed");
      }
    }

    // The stream closed without the session going idle: see where it is, then reconnect.
    const session = await anthropic().beta.sessions.retrieve(sessionId);
    if (session.status === "idle") return lastText;
    if (session.status === "terminated") throw new CloudError("The cloud session ended unexpectedly.", "failed");
    await sleep(2_000);
  }
  throw new CloudError("Lost the connection to the cloud agent.", "failed");
}

/** Saves the session's deliverables to the idea; returns them and the agent's result JSON. */
async function collectOutputs(sessionId: string, row: IdeaRunRow, log: FastifyBaseLogger) {
  const listAll = async () => {
    const found = [];
    for await (const file of anthropic().beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) {
      found.push(file);
      if (found.length >= 60) break;
    }
    return found;
  };
  // Outputs take a moment to be indexed after the session goes idle.
  let files = await listAll();
  for (let i = 0; i < 3 && !files.length; i++) {
    await sleep(2_500);
    files = await listAll();
  }

  let resultOutput: unknown = null;
  const saved: AgentResult["files"] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const name = file.filename.split("/").pop() || file.filename;
    try {
      if (name === CLOUD_RESULT_FILE) {
        const response = await anthropic().beta.files.download(file.id);
        resultOutput = parseJsonLoose(await response.text());
        continue;
      }
      if (file.size_bytes > LIMITS.fileBytes || !classifyUpload(undefined, name)) {
        skipped.push(name);
        continue;
      }
      const response = await anthropic().beta.files.download(file.id);
      const data = Buffer.from(await response.arrayBuffer());
      const stored = await addFile(row.userId, row.ideaId, { name, mime: undefined, data });
      saved.push({ id: stored.id, name: stored.name });
    } catch (err) {
      log.warn({ err, runId: row.id, file: name }, "Could not save a cloud deliverable");
      skipped.push(name);
    }
  }
  if (skipped.length) log.info({ runId: row.id, skipped }, "Cloud deliverables not attached");
  return { resultOutput, saved };
}

async function build(row: IdeaRunRow, task: RunnerTask, progress: string[], signal: AbortSignal, log: FastifyBaseLogger) {
  const leaseId = row.leaseId!;
  let sessionId = row.cloudSessionId;
  let kickoff = false;
  let finishedWhileAway = false;

  if (sessionId) {
    // A restarted server picking up a build that was already running.
    const session = await anthropic().beta.sessions.retrieve(sessionId);
    if (session.status === "terminated") throw new CloudError("The cloud session ended unexpectedly.", "failed");
    finishedWhileAway = session.status === "idle";
  } else {
    const agent = await builder();
    const session = await anthropic().beta.sessions.create({
      agent: { type: "agent", id: agent.agentId, version: agent.agentVersion },
      environment_id: agent.environmentId,
      title: `Lightbulb: ${task.idea.title}`.slice(0, 120),
      budget: {
        type: "limit",
        max_list_cost: { amount: String(Math.round(env.CLOUD_BUILD_BUDGET_USD * 100)), currency: "USD" },
      },
    });
    sessionId = session.id;
    kickoff = true;
    await db.update(ideaRuns).set({ cloudSessionId: sessionId }).where(eq(ideaRuns.id, row.id));
  }

  // On shutdown the session keeps running; the next server start resumes following it.
  const shuttingDown = () => signal.aborted && signal.reason === "shutdown";
  try {
    const lastText = finishedWhileAway ? "" : await follow(sessionId, kickoff, task, progress, signal);
    const { resultOutput, saved } = await collectOutputs(sessionId, row, log);
    await reportResult(OWNER, row.id, leaseId, resultOutput ?? parseJsonLoose(lastText), { location: null, files: saved });
  } catch (err) {
    if (signal.aborted && !shuttingDown()) {
      await anthropic()
        .beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] })
        .catch(() => {});
    }
    throw err;
  } finally {
    if (!shuttingDown()) {
      await anthropic()
        .beta.sessions.archive(sessionId)
        .catch(() => {});
    }
  }
}

// ---------- Worker ----------

function describeError(err: unknown, timedOut: boolean, stage: string): { message: string; code: string } {
  if (timedOut) return { message: `The cloud agent ran out of time on the ${stage}.`, code: "timeout" };
  if (err instanceof CloudError) return { message: err.message, code: err.code };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) {
      return { message: "The server's Anthropic API key was rejected.", code: "auth" };
    }
    if (err.status === 429 || err.status === 529) {
      return { message: "The cloud agent is busy right now. Try again in a few minutes.", code: "failed" };
    }
    return { message: `The cloud agent hit an error (${err.status ?? "network"}).`, code: "failed" };
  }
  return { message: "The cloud agent hit an unexpected error.", code: "failed" };
}

async function work(row: IdeaRunRow, log: FastifyBaseLogger, shutdown: AbortSignal) {
  const leaseId = row.leaseId!;
  const controller = new AbortController();
  const onShutdown = () => controller.abort("shutdown");
  shutdown.addEventListener("abort", onShutdown, { once: true });

  let cancelled = false;
  let timedOut = false;
  const progress: string[] = [];
  let lastBeat = Date.now();
  let stage = "task";

  // Reports progress (which also extends the lease) and learns about cancellation.
  const tick = setInterval(() => {
    const lines = progress.splice(0, 20);
    if (!lines.length && Date.now() - lastBeat < HEARTBEAT_MS) return;
    lastBeat = Date.now();
    const report = lines.length
      ? reportProgress(OWNER, row.id, leaseId, lines)
      : heartbeat(OWNER, row.id, leaseId);
    report
      .then((ack) => {
        if (ack.cancelled) {
          cancelled = true;
          controller.abort("cancelled");
        }
      })
      .catch((err) => log.warn({ err, runId: row.id }, "Cloud heartbeat failed"));
  }, TICK_MS);

  let timer: NodeJS.Timeout | undefined;
  try {
    const task = await buildTask(row);
    stage = task.stage;
    const limitMs = task.stage === "build" ? env.CLOUD_BUILD_TIMEOUT_MINUTES * 60_000 : THINK_TIMEOUT_MS;
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, limitMs);

    if (task.stage === "options") {
      const output = await think(optionsPrompt(task, CONTEXT), OPTIONS_SCHEMA, "medium", controller.signal);
      await reportOptions(OWNER, row.id, leaseId, output);
    } else if (task.stage === "plan") {
      const output = await think(planPrompt(task, CONTEXT), PLAN_SCHEMA, "high", controller.signal);
      await reportPlan(OWNER, row.id, leaseId, output);
    } else {
      await build(row, task, progress, controller.signal, log);
    }
  } catch (err) {
    // On shutdown the lease simply runs out and the task is picked up again after a restart.
    if (shutdown.aborted || cancelled) return;
    const { message, code } = describeError(err, timedOut, stage);
    log.warn({ err, runId: row.id }, "Cloud agent task failed");
    await reportFailure(OWNER, row.id, leaseId, message, code).catch(() => {});
  } finally {
    clearInterval(tick);
    clearTimeout(timer);
    shutdown.removeEventListener("abort", onShutdown);
  }
}

/** Starts the in-process cloud worker. Returns a function that stops it. */
export function startCloudWorker(log: FastifyBaseLogger): () => Promise<void> {
  if (!cloudAvailable) return async () => {};
  const stop = new AbortController();
  const active = new Set<Promise<void>>();

  const loop = async () => {
    while (!stop.signal.aborted) {
      if (active.size >= env.CLOUD_MAX_CONCURRENT) {
        await Promise.race([...active, waitForWork(CLOUD_QUEUE, TICK_MS, stop.signal)]);
        continue;
      }
      let row: IdeaRunRow | null = null;
      try {
        row = await claimRun(OWNER);
      } catch (err) {
        log.warn({ err }, "Cloud worker could not claim work");
      }
      if (row) {
        const job: Promise<void> = work(row, log, stop.signal).finally(() => active.delete(job));
        active.add(job);
        continue;
      }
      await waitForWork(CLOUD_QUEUE, TICK_MS, stop.signal);
    }
  };

  const running = loop();
  log.info({ model: env.AGENT_MODEL }, "Cloud agent worker started");
  return async () => {
    stop.abort("shutdown");
    await Promise.allSettled([running, ...active]);
  };
}
