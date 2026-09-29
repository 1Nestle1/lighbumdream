import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunnerAck, RunnerClaimResponse, RunnerHelloResponse, RunnerTask } from "@lightbulb/shared";
import { AGENT_LABELS } from "@lightbulb/shared/constants";
import {
  OPTIONS_SCHEMA,
  PLAN_SCHEMA,
  RESULT_SCHEMA,
  buildPrompt,
  optionsPrompt,
  planPrompt,
  type PromptContext,
} from "@lightbulb/shared/protocol";
import { AgentError, runAgent, type FoundAgent } from "./agents.js";
import { ApiError, type Api } from "./api.js";
import { VERSION, workspaceDir, type Config } from "./config.js";
import { c, log } from "./log.js";

const THINK_TIMEOUT_MS = 15 * 60_000;
const REPORT_EVERY_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const ATTACHMENTS = ".lightbulb/attachments";

const STAGE_LABEL = { options: "Finding options", plan: "Writing the plan", build: "Building" } as const;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export const platformName = () => `${process.platform}-${process.arch}`;

/** The idea's folder under the workspace, with its attachments downloaded next to the work. */
async function prepareProject(api: Api, config: Config, task: RunnerTask): Promise<string> {
  const dir = path.join(workspaceDir(config), task.projectSlug);
  const meta = path.join(dir, ".lightbulb");
  await mkdir(meta, { recursive: true });
  // Keep Lightbulb's scratch files out of any git repository the agent creates.
  await writeFile(path.join(meta, ".gitignore"), "*\n");

  if (task.idea.files.length) {
    const attachments = path.join(dir, ATTACHMENTS);
    await mkdir(attachments, { recursive: true });
    for (const file of task.idea.files) {
      const safeName = path.basename(file.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || file.id;
      const destination = path.join(attachments, safeName);
      const existing = await stat(destination).catch(() => null);
      if (existing?.size === file.sizeBytes) continue;
      await api.download(`/runner/files/${file.id}`, destination).catch((err) => {
        log.warn(`Couldn't download ${file.name}: ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  if (task.stage === "build" && task.plan) {
    const plan = task.plan;
    const lines = [
      `# ${plan.title}`,
      "",
      plan.summary,
      "",
      "## Steps",
      ...plan.steps.map((step, i) => `${i + 1}. **${step.title}**${step.detail ? `\n   ${step.detail}` : ""}`),
    ];
    await writeFile(path.join(meta, "plan.md"), lines.join("\n") + "\n");
  }
  return dir;
}

async function handleTask(api: Api, config: Config, agents: Map<string, FoundAgent>, task: RunnerTask, stop: AbortSignal) {
  const label = AGENT_LABELS[task.agent];
  const report = <T = RunnerAck>(what: string, body: object) =>
    api.post<T>(`/runner/runs/${task.runId}/${what}`, { leaseId: task.leaseId, ...body });

  log.step(`${c.bold(STAGE_LABEL[task.stage])} · ${task.idea.title} ${c.dim(`(${label})`)}`);

  const found = agents.get(task.agent);
  if (!found) {
    const message = `${label} isn't installed on this computer, or isn't on PATH.`;
    log.error(message);
    await report("fail", { message, code: "agent_missing" }).catch(() => {});
    return;
  }

  const work = new AbortController();
  const onStop = () => work.abort("stopped");
  stop.addEventListener("abort", onStop, { once: true });

  // Sends progress (which also keeps the task leased to us) and hears about cancellation.
  const pending: string[] = [];
  let lastReport = Date.now();
  const ticker = setInterval(() => {
    if (!pending.length && Date.now() - lastReport < HEARTBEAT_MS) return;
    lastReport = Date.now();
    const lines = pending.splice(0, 20);
    const call = lines.length ? report("progress", { lines }) : report("heartbeat", {});
    call
      .then((ack) => {
        if (ack.cancelled && !work.signal.aborted) {
          log.warn("Cancelled from Lightbulb. Stopping the agent.");
          work.abort("cancelled");
        }
      })
      .catch((err) => log.warn(`Couldn't reach Lightbulb: ${err instanceof Error ? err.message : err}`));
  }, REPORT_EVERY_MS);

  try {
    const cwd = await prepareProject(api, config, task);
    const context: PromptContext = {
      place: "local",
      attachmentsDir: task.idea.files.length ? ATTACHMENTS : null,
    };
    const settings = config.agents?.[task.agent] ?? {};
    const common = {
      cwd,
      settings,
      signal: work.signal,
      onProgress: (line: string) => {
        if (!line) return;
        pending.push(line);
        log.progress(line.length > 160 ? `${line.slice(0, 159)}…` : line);
      },
    };

    if (task.stage === "options") {
      const output = await runAgent(found, {
        ...common,
        mode: "think",
        prompt: optionsPrompt(task, context),
        schema: OPTIONS_SCHEMA,
        timeoutMs: THINK_TIMEOUT_MS,
      });
      const ack = await report("options", { output });
      if (ack.ok) log.ok("Options sent. Pick one in Lightbulb.");
      else log.warn("Lightbulb didn't accept the options; see the idea page.");
    } else if (task.stage === "plan") {
      const output = await runAgent(found, {
        ...common,
        mode: "think",
        prompt: planPrompt(task, context),
        schema: PLAN_SCHEMA,
        timeoutMs: THINK_TIMEOUT_MS,
      });
      const ack = await report("plan", { output });
      if (ack.ok) log.ok("Plan sent. Review and approve it in Lightbulb.");
      else log.warn("Lightbulb didn't accept the plan; see the idea page.");
    } else {
      log.info(c.dim(`Project folder: ${cwd}`));
      const output = await runAgent(found, {
        ...common,
        mode: "build",
        prompt: buildPrompt(task, context),
        schema: RESULT_SCHEMA,
        timeoutMs: (config.buildTimeoutMinutes ?? 90) * 60_000,
      });
      if (pending.length) await report("progress", { lines: pending.splice(0, 20) }).catch(() => {});
      await report("result", { output, location: cwd });
      log.ok(`Built. Everything is in ${cwd}`);
    }
  } catch (err) {
    if (work.signal.reason === "cancelled") return; // Lightbulb already knows
    const stopped = work.signal.reason === "stopped";
    const message = stopped
      ? "Stopped on the computer before the agent finished."
      : err instanceof AgentError || err instanceof ApiError
        ? err.message
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    const code = err instanceof AgentError && !stopped ? err.code : "failed";
    log.error(message);
    await report("fail", { message, code }).catch(() => {});
  } finally {
    clearInterval(ticker);
    stop.removeEventListener("abort", onStop);
  }
}

/** Takes tasks from Lightbulb, one at a time, until stopped. */
export async function runWorker(api: Api, config: Config, agents: FoundAgent[], stop: AbortSignal) {
  const hello = await api.post<RunnerHelloResponse>("/runner/hello", {
    agents: agents.map((a) => a.kind),
    version: VERSION,
    platform: platformName(),
  });

  log.plain();
  log.plain(`${c.bold("Lightbulb runner")} ${c.dim(VERSION)}`);
  log.plain(`  Computer   ${hello.runner.name} ${c.dim(`(${hello.email})`)}`);
  log.plain(`  Agents     ${agents.length ? agents.map((a) => AGENT_LABELS[a.kind]).join(", ") : c.red("none found")}`);
  log.plain(`  Projects   ${workspaceDir(config)}`);
  log.plain();
  if (!agents.length) {
    log.warn("Install an agent CLI (Claude Code, Codex, Cursor CLI or Gemini CLI), then start the runner again.");
  }
  log.info(`Waiting for ideas. Send one from Lightbulb and choose ${c.bold(`"${hello.runner.name}"`)}. Ctrl+C stops.`);

  const byKind = new Map(agents.map((a) => [a.kind, a]));
  let backoff = 2_000;
  while (!stop.aborted) {
    try {
      const { task } = await api.post<RunnerClaimResponse>("/runner/claim", {}, { signal: stop, timeoutMs: 45_000 });
      backoff = 2_000;
      if (task) await handleTask(api, config, byKind, task, stop);
    } catch (err) {
      if (stop.aborted) break;
      if (err instanceof ApiError && err.status === 401) {
        throw new Error("This computer was disconnected from Lightbulb. Run `lightbulb login` to connect it again.");
      }
      log.warn(`Can't reach ${api.server} (${err instanceof Error ? err.message : err}). Retrying in ${backoff / 1000}s.`);
      await sleep(backoff, stop);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

export const defaultComputerName = () => os.hostname().replace(/\.local$/, "").slice(0, 60) || "My computer";
