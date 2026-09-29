import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKind } from "@lightbulb/shared";
import { AGENT_LABELS } from "@lightbulb/shared/constants";
import { jsonOnly, parseJsonLoose } from "@lightbulb/shared/protocol";
import type { AgentSettings } from "./config.js";
import { probe, runProcess, type ProcessResult } from "./process.js";

// Adapters for the agent CLIs' headless modes:
//   Claude Code  claude -p --output-format json|stream-json --json-schema   (prompt on stdin)
//   Codex        codex exec --json --output-schema FILE -o FILE -           (prompt on stdin)
//   Cursor       cursor-agent -p --output-format json [--force]             (prompt in a file)
//   Gemini CLI   gemini --output-format json --approval-mode MODE           (prompt on stdin)
// "think" (options, plans) must not change anything; "build" may edit the project folder.

export type FailCode = "agent_missing" | "auth" | "invalid_output" | "timeout" | "failed";

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: FailCode,
  ) {
    super(message);
  }
}

export interface AgentJob {
  mode: "think" | "build";
  prompt: string;
  /** JSON Schema of the answer. */
  schema: Record<string, unknown>;
  /** The idea's project folder. */
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  settings: AgentSettings;
  onProgress: (line: string) => void;
}

export interface FoundAgent {
  kind: AgentKind;
  command: string;
  version: string;
}

interface Adapter {
  kind: AgentKind;
  detect(): FoundAgent | null;
  run(command: string, job: AgentJob): Promise<unknown>;
}

const AUTH_PATTERN = /not (logged|signed) in|log ?in|authenticat|unauthori[sz]ed|oauth|api[ _-]?key|\b401\b/i;

const tryJson = (line: string): Record<string, any> | null => {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const clip = (text: string, max = 300) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const firstLine = (text: string) => text.split("\n").find((line) => line.trim())?.trim() ?? "";

function describeTool(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const detail = ["command", "file_path", "path", "pattern", "url"]
    .map((key) => fields[key])
    .find((value): value is string => typeof value === "string");
  return detail ? `${name}: ${detail}` : name;
}

/** Turns a process that didn't produce an answer into a clear error. */
function failure(label: string, result: ProcessResult, detail: string, loginHint: string): AgentError {
  if (result.error) return new AgentError(`${label} couldn't be started: ${result.error.message}`, "agent_missing");
  if (result.timedOut) return new AgentError(`${label} ran out of time.`, "timeout");
  const text = detail || result.stderr || result.stdout;
  if (AUTH_PATTERN.test(text)) return new AgentError(`${label} isn't signed in on this computer. ${loginHint}`, "auth");
  return new AgentError(`${label} stopped: ${clip(text) || `exit code ${result.code}`}`, "failed");
}

/** Scratch files for an agent call, inside the project's .lightbulb folder. */
async function scratch(cwd: string, name: string) {
  const dir = path.join(cwd, ".lightbulb");
  await mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

// ---------- Claude Code ----------

/** What a Claude Code build may do without asking: edit the project and run common dev tools. */
export const CLAUDE_BUILD_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(npm *)",
  "Bash(npx *)",
  "Bash(node *)",
  "Bash(pnpm *)",
  "Bash(yarn *)",
  "Bash(python *)",
  "Bash(python3 *)",
  "Bash(pip *)",
  "Bash(git init*)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(git status*)",
  "Bash(mkdir *)",
  "Bash(ls*)",
];

const claude: Adapter = {
  kind: "claude",
  detect() {
    const version = probe("claude", ["--version"]);
    return version === null ? null : { kind: "claude", command: "claude", version: firstLine(version) };
  },
  async run(command, job) {
    const { settings } = job;
    const args = ["-p", "--json-schema", JSON.stringify(job.schema), "--no-session-persistence"];
    if (settings.model) args.push("--model", settings.model);
    if (settings.maxBudgetUsd) args.push("--max-budget-usd", String(settings.maxBudgetUsd));
    if (job.mode === "think") {
      // dontAsk: anything that would need permission (edits, commands) is denied; reading is fine.
      args.push("--output-format", "json", "--permission-mode", "dontAsk");
    } else {
      args.push(
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        settings.permissionMode ?? "acceptEdits",
        "--allowedTools",
        (settings.allowedTools ?? CLAUDE_BUILD_TOOLS).join(","),
      );
    }

    let final: Record<string, any> | null = null;
    const result = await runProcess(command, args, {
      cwd: job.cwd,
      stdin: job.prompt,
      signal: job.signal,
      timeoutMs: job.timeoutMs,
      onLine:
        job.mode === "build"
          ? (line) => {
              const event = tryJson(line);
              if (!event) return;
              if (event.type === "result") final = event;
              if (event.type !== "assistant") return;
              for (const block of event.message?.content ?? []) {
                if (block.type === "text" && block.text) job.onProgress(firstLine(block.text));
                if (block.type === "tool_use") job.onProgress(describeTool(block.name, block.input));
              }
            }
          : undefined,
    });
    if (result.aborted) throw new AgentError("Stopped.", "failed");
    if (job.mode === "think") final = tryJson(result.stdout.trim());

    const hint = "Run `claude` once and sign in, then retry.";
    if (!final) throw failure(AGENT_LABELS.claude, result, "", hint);
    if (final.is_error) throw failure(AGENT_LABELS.claude, result, String(final.result ?? final.subtype ?? ""), hint);
    return final.structured_output ?? parseJsonLoose(String(final.result ?? ""));
  },
};

// ---------- Codex ----------

const codex: Adapter = {
  kind: "codex",
  detect() {
    const version = probe("codex", ["--version"]);
    return version === null ? null : { kind: "codex", command: "codex", version: firstLine(version) };
  },
  async run(command, job) {
    const schemaFile = await scratch(job.cwd, "codex-schema.json");
    const answerFile = await scratch(job.cwd, "codex-answer.json");
    await writeFile(schemaFile, JSON.stringify(job.schema));
    await rm(answerFile, { force: true });

    const sandbox = job.mode === "think" ? "read-only" : (job.settings.sandbox ?? "workspace-write");
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox, "--output-schema", schemaFile, "-o", answerFile, "-C", job.cwd];
    if (job.settings.model) args.push("-m", job.settings.model);
    args.push("-"); // read the prompt from stdin

    let errorText = "";
    const result = await runProcess(command, args, {
      cwd: job.cwd,
      stdin: job.prompt,
      signal: job.signal,
      timeoutMs: job.timeoutMs,
      onLine: (line) => {
        const event = tryJson(line);
        if (!event) return;
        if (event.type === "error" || event.type === "turn.failed") {
          errorText = String(event.message ?? event.error?.message ?? "");
        }
        const item = event.item;
        if (!item) return;
        if (event.type === "item.started" && item.type === "command_execution") job.onProgress(`$ ${item.command}`);
        if (event.type === "item.completed" && item.type === "file_change") {
          const paths = (item.changes ?? []).map((change: { path?: string }) => change.path).filter(Boolean);
          if (paths.length) job.onProgress(`Edited ${paths.join(", ")}`);
        }
        if (event.type === "item.completed" && item.type === "agent_message" && item.text) {
          job.onProgress(firstLine(String(item.text)));
        }
      },
    });
    if (result.aborted) throw new AgentError("Stopped.", "failed");

    const answer = await readFile(answerFile, "utf8").catch(() => "");
    if (!answer.trim()) throw failure(AGENT_LABELS.codex, result, errorText, "Run `codex login`, then retry.");
    return parseJsonLoose(answer);
  },
};

// ---------- Cursor ----------

const cursor: Adapter = {
  kind: "cursor",
  detect() {
    const version = probe("cursor-agent", ["--version"]);
    if (version !== null) return { kind: "cursor", command: "cursor-agent", version: firstLine(version) };
    // Newer installs call it plain `agent`; make sure that's Cursor's.
    const help = probe("agent", ["--help"]);
    if (help !== null && /cursor/i.test(help)) {
      return { kind: "cursor", command: "agent", version: firstLine(probe("agent", ["--version"]) ?? "") };
    }
    return null;
  },
  async run(command, job) {
    // The prompt is long and multi-line, so it goes in a file rather than on the command line.
    const taskFile = await scratch(job.cwd, "task.md");
    await writeFile(taskFile, job.prompt + jsonOnly(job.schema));
    const args = ["-p", "--output-format", "json"];
    if (job.mode === "build") args.push("--force");
    if (job.settings.model) args.push("--model", job.settings.model);
    args.push("Read the file .lightbulb/task.md and follow it exactly. Reply with only the JSON object it asks for.");

    const result = await runProcess(command, args, {
      cwd: job.cwd,
      signal: job.signal,
      timeoutMs: job.timeoutMs,
    });
    if (result.aborted) throw new AgentError("Stopped.", "failed");
    const output = tryJson(result.stdout.trim());
    const hint = "Run `cursor-agent login` (or set CURSOR_API_KEY), then retry.";
    if (!output || output.is_error) throw failure(AGENT_LABELS.cursor, result, String(output?.result ?? ""), hint);
    return parseJsonLoose(String(output.result ?? ""));
  },
};

// ---------- Gemini CLI ----------

const gemini: Adapter = {
  kind: "gemini",
  detect() {
    const version = probe("gemini", ["--version"]);
    return version === null ? null : { kind: "gemini", command: "gemini", version: firstLine(version) };
  },
  async run(command, job) {
    const approval = job.mode === "think" ? "default" : (job.settings.approvalMode ?? "auto_edit");
    const args = ["--output-format", "json", "--approval-mode", approval];
    if (job.settings.model) args.push("-m", job.settings.model);

    const result = await runProcess(command, args, {
      cwd: job.cwd,
      stdin: job.prompt + jsonOnly(job.schema),
      signal: job.signal,
      timeoutMs: job.timeoutMs,
    });
    if (result.aborted) throw new AgentError("Stopped.", "failed");
    const output = tryJson(result.stdout.trim());
    const hint = "Run `gemini` once and sign in (or set GEMINI_API_KEY), then retry.";
    if (!output || output.error || typeof output.response !== "string") {
      throw failure(AGENT_LABELS.gemini, result, String(output?.error?.message ?? ""), hint);
    }
    return parseJsonLoose(output.response);
  },
};

const ADAPTERS: Record<AgentKind, Adapter> = { claude, codex, cursor, gemini };

/** Agent CLIs installed on this computer. */
export function detectAgents(): FoundAgent[] {
  return Object.values(ADAPTERS)
    .map((adapter) => adapter.detect())
    .filter((found): found is FoundAgent => found !== null);
}

export function runAgent(found: FoundAgent, job: AgentJob): Promise<unknown> {
  return ADAPTERS[found.kind].run(found.command, job);
}
