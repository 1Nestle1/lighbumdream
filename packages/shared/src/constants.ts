// Runtime constants with no dependencies, so the web bundle can import them without zod.

/** Interface languages. Voice recognition uses the same set. */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Icons a folder can carry. Names match @phosphor-icons/react exports so the
 * web app can render them directly, and the LLM picks from this closed list.
 */
export const FOLDER_ICONS = [
  "Folder",
  "Robot",
  "Code",
  "TelegramLogo",
  "DeviceMobile",
  "Globe",
  "House",
  "Briefcase",
  "CurrencyDollar",
  "ShoppingCart",
  "Heart",
  "Barbell",
  "GameController",
  "PaintBrush",
  "Camera",
  "MusicNotes",
  "BookOpen",
  "GraduationCap",
  "Leaf",
  "Airplane",
  "ForkKnife",
  "Wrench",
  "Lightning",
  "ChatCircle",
  "Users",
  "ChartLine",
] as const;

/** Search snippets wrap matches in these, so the client can highlight without rendering HTML. */
export const SNIPPET_MARK_START = "\u0001";
export const SNIPPET_MARK_END = "\u0002";

/** Idea pages are deliberately small: these caps keep them focused on moving the idea forward. */
export const LIMITS = {
  bodyChars: 4000,
  steps: 30,
  stepChars: 200,
  notes: 200,
  noteChars: 1000,
  files: 50,
  fileBytes: 20 * 1024 * 1024,
  userStorageBytes: 1024 * 1024 * 1024,
  promptChars: 4000,
} as const;

// ---------- Agents ----------

/** Coding agents the local runner (`lightbulb` CLI) can drive on the user's computer. */
export const AGENT_KINDS = ["claude", "codex", "cursor", "gemini"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
};

/**
 * A run walks options -> pick -> plan -> approve -> build. The *_pending states and
 * "building" are work for an agent; the *_ready states wait for the user.
 */
export const RUN_STATUSES = [
  "options_pending",
  "options_ready",
  "plan_pending",
  "plan_ready",
  "building",
  "done",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
/** "prompt": carry out the user's own instruction in an existing project. */
export type RunStage = "options" | "plan" | "build" | "prompt";

/** "loop": options, plan, approve, build. "prompt": one instruction the user wrote, run at once. */
export type RunKind = "loop" | "prompt";

export const ACTIVE_RUN_STATUSES = [
  "options_pending",
  "options_ready",
  "plan_pending",
  "plan_ready",
  "building",
] as const satisfies readonly RunStatus[];

export const AGENT_LIMITS = {
  options: 4,
  commentChars: 1000,
  progressLines: 40,
  followUps: 5,
} as const;
