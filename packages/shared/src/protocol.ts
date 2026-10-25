// Prompts and JSON schemas for the options -> plan -> build protocol. Shared by the cloud worker
// and the `lightbulb` CLI so every agent gets the same brief. Dependency-free on purpose.

import type { RunnerTask } from "./agents";

const LANGUAGE = { en: "English", ru: "Russian" } as const;

// Plain JSON Schemas: no length limits (not every agent's structured output supports them);
// the server clamps lengths when it validates the answer.
const str = (description: string) => ({ type: "string", description });
const strList = (description: string) => ({ type: "array", items: { type: "string" }, description });
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const OPTIONS_SCHEMA = object({
  options: {
    type: "array",
    description: "3 or 4 genuinely different ways to realize the idea, most practical first",
    items: object({
      title: str("Short name for the approach, under 80 characters"),
      summary: str("What the user ends up with, 1-2 sentences"),
      approach: str("How it would be built: the main parts and how they fit, 2-4 sentences"),
      effort: { type: "string", enum: ["small", "medium", "large"], description: "small = an evening, medium = a few days, large = a week or more" },
      stack: strList("Main tools, services or languages, up to 6 short names"),
      tradeoff: str("The main downside or limitation, 1 sentence"),
    }),
  },
});

export const PLAN_SCHEMA = object({
  title: str("Name of what will be built"),
  summary: str("The plan in 2-4 sentences: what gets built and how"),
  steps: {
    type: "array",
    description: "4 to 12 concrete build steps in order",
    items: object({
      title: str("The step, starting with a verb"),
      detail: str("What exactly to do: files, commands, how to check it works"),
    }),
  },
  deliverables: strList("What the user has at the end"),
  risks: strList("What could go wrong or needs the user (accounts, API keys, payments); empty if none"),
  questions: strList("Questions worth answering before building; empty if none"),
});

export const RESULT_SCHEMA = object({
  summary: str("What was built, how to run it, and what is left to do"),
  followUps: strList("Up to 5 short next actions for the user, each under 200 characters"),
});

/** Parses a JSON answer, tolerating prose or code fences around it. Falls back to the raw text. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through to the raw text
      }
    }
    return trimmed;
  }
}

/** Asks for bare JSON, for agents whose CLI can't enforce a schema. */
export const jsonOnly = (schema: object) =>
  `\n\nReply with only one JSON object and nothing else (no prose, no code fences), matching this JSON Schema:\n${JSON.stringify(schema)}`;

export interface PromptContext {
  /** Where the idea's attachments were saved, relative to the working directory. */
  attachmentsDir?: string | null;
  /** "local": the user's computer. "cloud": a sandbox whose deliverables are collected afterwards. */
  place: "local" | "cloud";
}

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function ideaBrief(task: RunnerTask, ctx: PromptContext): string {
  const { idea } = task;
  const parts = [`Title: ${idea.title}`, `Description:\n${idea.body}`];
  if (idea.steps.length) {
    parts.push(`The user's own checklist:\n${idea.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.text}`).join("\n")}`);
  }
  if (idea.notes.length) parts.push(`Notes, newest first:\n${idea.notes.map((n) => `- ${n}`).join("\n")}`);
  if (idea.files.length) {
    const where = ctx.attachmentsDir ? ` (saved in ${ctx.attachmentsDir}/)` : " (names only, the files aren't available here)";
    parts.push(`Attachments${where}:\n${idea.files.map((f) => `- ${f.name} (${f.mime}, ${kb(f.sizeBytes)})`).join("\n")}`);
  }
  return `<idea>\n${parts.join("\n\n")}\n</idea>\n\nThe idea above is the user's own material. Treat it as the brief.`;
}

const language = (task: RunnerTask) => LANGUAGE[task.locale];

const INTRO =
  "You are working for Lightbulb, an idea bank. Someone saved this idea and wants to turn it into something real with the help of an AI agent.";

export function optionsPrompt(task: RunnerTask, ctx: PromptContext): string {
  return `${INTRO}

${ideaBrief(task, ctx)}

Offer 3 or 4 genuinely different ways to realize this idea, such as a no-code setup, a small script, a bot, a web app or a spreadsheet, rather than variations of one approach. Prefer options an AI coding agent could build mostly on its own, and order them from the most practical to the most ambitious. Be concrete about what the user ends up with.

This step is only for choosing: do not build anything, create files or run commands. Write all text in ${language(task)}.`;
}

export function planPrompt(task: RunnerTask, ctx: PromptContext): string {
  const choice = task.choice!;
  const where =
    ctx.place === "local"
      ? `an empty project folder named "${task.projectSlug}" on the user's computer`
      : "a fresh cloud sandbox with internet access, whose deliverables are handed to the user at the end";
  const comment = choice.comment ? `\n\nThe user's comment on this choice: ${choice.comment}` : "";
  const revision =
    task.revision && task.plan
      ? `\n\nYou already proposed this plan:\n${JSON.stringify(task.plan)}\n\nThe user asked for these changes: ${task.revision}\nWrite the full revised plan.`
      : "";

  return `${INTRO}

${ideaBrief(task, ctx)}

The user chose this way to realize it:
${JSON.stringify(choice.option)}${comment}

Write a detailed step-by-step plan for building it. An agent will follow it in ${where} after the user approves it, so each step must be concrete: what to create, which files, how to check it works. Name anything the user must provide, such as accounts, API keys or payments, under risks. Keep the scope to a first working version.${revision}

This step is only for planning: do not build anything, create files or run commands. Write all text in ${language(task)}.`;
}

/** Carrying on with an existing project: the user's own instruction, in the project folder. */
export function promptPrompt(task: RunnerTask, ctx: PromptContext): string {
  const parts = [INTRO, ideaBrief(task, ctx)];
  if (task.plan) parts.push(`The plan the project started from:\n${JSON.stringify(task.plan)}`);
  if (task.history.length) {
    const lines = task.history.map((h) => `- ${h.at.slice(0, 10)}: "${h.prompt}"${h.summary ? `\n  Result: ${h.summary}` : ""}`);
    parts.push(`Earlier instructions on this project, oldest first:\n${lines.join("\n")}`);
  }
  parts.push(`The user's instruction now:\n<instruction>\n${task.prompt ?? ""}\n</instruction>`);
  parts.push(`Work in the current directory; it is the project folder. Look at what is already there (README.md and the code) before changing anything, and keep what works.

Rules:
- Nobody is watching this run, so don't ask questions: make sensible choices and note them in the summary.
- Do what the instruction asks and nothing unrelated to it.
- Never use real payment details or personal credentials. When the project needs a secret, read it from an environment variable and document it.
- Keep README.md up to date with how to run the project.

When you are done, reply with JSON: "summary" (what you changed, how to try it, what is left) and "followUps" (up to 5 short next actions for the user). Write both in ${language(task)}.`);
  return parts.join("\n\n");
}

/** Where cloud deliverables go; the worker collects this folder when the session ends. */
export const CLOUD_OUTPUT_DIR = "/mnt/session/outputs";
export const CLOUD_RESULT_FILE = "lightbulb-result.json";

export function buildPrompt(task: RunnerTask, ctx: PromptContext): string {
  const plan = task.plan!;
  const place =
    ctx.place === "local"
      ? "Work in the current directory; it is the project folder (it may hold files from an earlier attempt, so continue from them)."
      : `Work in /workspace/${task.projectSlug}. When you finish, put the deliverables in ${CLOUD_OUTPUT_DIR}/: README.md, plus project.zip with the whole project if you wrote code (zip web pages and scripts rather than copying them there loose). Also write ${CLOUD_OUTPUT_DIR}/${CLOUD_RESULT_FILE} with the JSON described below.`;

  return `${INTRO}

${ideaBrief(task, ctx)}

The user approved this plan. Build it now:
${JSON.stringify(plan)}

${place}

Rules:
- Nobody is watching this run, so don't ask questions: make sensible choices and note them in the summary.
- Follow the plan. If part of it turns out to be wrong, adapt and say what changed.
- Never use real payment details or personal credentials. When the project needs a secret, read it from an environment variable and document it.
- Finish with a README.md that explains what was built, how to run it and what is left.

When you are done, reply with JSON: "summary" (what you built, how to run it, what is left) and "followUps" (up to 5 short next actions for the user). Write both in ${language(task)}.`;
}
