import { z } from "zod";
import {
  AGENT_KINDS,
  AGENT_LIMITS,
  LIMITS,
  type AgentKind,
  type Locale,
  type RunKind,
  type RunStage,
  type RunStatus,
} from "./constants";

// An idea goes to an agent in the cloud or on the user's computer. The agent offers options,
// the user picks one, the agent writes a detailed plan, and only an approved plan gets built.

/** Agent answers are clamped rather than rejected: a slightly long title shouldn't fail a run. */
const clamped = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[ \t]+/g, " ").trim())
    .transform((s) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…"));
const required = (max: number) => clamped(max).refine((s) => s.length > 0, "Required");
const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .catch([])
    .transform((items) => items.slice(0, max));

export const AgentEffortSchema = z.enum(["small", "medium", "large"]);
export type AgentEffort = z.infer<typeof AgentEffortSchema>;

export const AgentOptionSchema = z.object({
  title: required(80),
  summary: required(400),
  approach: clamped(800).catch(""),
  effort: AgentEffortSchema.catch("medium"),
  stack: list(required(40), 6),
  tradeoff: clamped(300).catch(""),
});
export type AgentOption = z.infer<typeof AgentOptionSchema>;

export const AgentOptionsOutput = z.object({
  options: z
    .array(AgentOptionSchema)
    .min(2)
    .transform((options) => options.slice(0, AGENT_LIMITS.options)),
});

export const AgentPlanSchema = z.object({
  title: required(120),
  summary: required(1200),
  steps: z
    .array(z.object({ title: required(160), detail: clamped(1200).catch("") }))
    .min(1)
    .transform((steps) => steps.slice(0, 15)),
  deliverables: list(required(200), 10),
  risks: list(required(300), 6),
  questions: list(required(300), 5),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const AgentResultOutput = z.object({
  summary: required(4000),
  followUps: list(required(LIMITS.stepChars), AGENT_LIMITS.followUps),
});

export interface AgentResult {
  summary: string;
  /** Suggested next steps for the user; each can be added to the idea's checklist. */
  followUps: string[];
  /** Where the work is on the user's computer (local runs). */
  location: string | null;
  /** Deliverables saved to the idea's files: cloud outputs, and the project zip of local builds. */
  files: { id: string; name: string }[];
  /** Set once the project has been published to GitHub. */
  repo?: { url: string; fullName: string } | null;
}

export interface RunChoice {
  index: number;
  title: string;
  comment: string | null;
}

export interface RunError {
  stage: RunStage;
  message: string;
  /** agent_missing | auth | invalid_output | timeout | budget | offline | failed */
  code: string | null;
}

export const RUN_EVENT_KINDS = [
  "started",
  "options",
  "chose",
  "plan",
  "revise",
  "approved",
  "done",
  "failed",
  "retried",
  "cancelled",
  "published",
  "prompted",
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export interface RunEvent {
  id: string;
  kind: RunEventKind;
  /** Option title, comment or error message, depending on the kind. */
  text: string | null;
  createdAt: string;
}

export interface RunRunnerRef {
  id: string;
  name: string;
  online: boolean;
}

export interface IdeaRun {
  id: string;
  ideaId: string;
  target: "cloud" | "local";
  /** The computer a local run is assigned to; null for cloud runs or a removed computer. */
  runner: RunRunnerRef | null;
  agent: AgentKind | "cloud";
  kind: RunKind;
  /** The user's instruction, for prompt runs. */
  prompt: string | null;
  status: RunStatus;
  options: AgentOption[] | null;
  choice: RunChoice | null;
  plan: AgentPlan | null;
  /** Increments with every plan; approval names the version the user saw. */
  planVersion: number;
  /** The change request the next plan answers. */
  revision: string | null;
  result: AgentResult | null;
  error: RunError | null;
  /** Latest progress lines from the agent while it works. */
  progress: string[];
  /** True while an agent holds the task, i.e. it is working on it right now. */
  working: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: RunEvent[];
}

export interface IdeaRunsResponse {
  runs: IdeaRun[];
}

/** A prompt to carry on with a project on one of your computers. Runs at once: it's your instruction. */
export const SendPromptBody = z.object({
  prompt: z.string().trim().min(1).max(LIMITS.promptChars),
  runnerId: z.uuid(),
  agent: z.enum(AGENT_KINDS),
});
export type SendPromptBody = z.infer<typeof SendPromptBody>;

// ---------- Projects board ----------
// An idea becomes a project once an agent has worked on it. You star favourites; the board shows
// them first, then the projects you touched most recently.

export interface ProjectCard {
  idea: { id: string; title: string; nextStep: string | null; folderId: string | null; projectPath: string | null };
  favoriteAt: string | null;
  /** The project's latest run, without its event history. */
  latestRun: Omit<IdeaRun, "events"> | null;
  /** The computer the project last ran on, the default for the next prompt. */
  lastRunner: RunRunnerRef | null;
  lastActivityAt: string;
}

export interface ProjectsResponse {
  favorites: ProjectCard[];
  /** Projects with agent work, latest first, not counting favourites. */
  recent: ProjectCard[];
}

export const FavoriteBody = z.object({ favorite: z.boolean() });

export const StartRunBody = z.discriminatedUnion("target", [
  z.object({ target: z.literal("cloud") }),
  z.object({ target: z.literal("local"), runnerId: z.uuid(), agent: z.enum(AGENT_KINDS) }),
]);
export type StartRunBody = z.infer<typeof StartRunBody>;

const Comment = z.string().trim().max(AGENT_LIMITS.commentChars);

export const ChooseOptionBody = z.object({
  index: z.number().int().min(0).max(AGENT_LIMITS.options - 1),
  comment: Comment.optional(),
});
export type ChooseOptionBody = z.infer<typeof ChooseOptionBody>;

export const ReviseRunBody = z.object({ comment: Comment.min(1) });
export const ApproveRunBody = z.object({ planVersion: z.number().int().min(1) });

// ---------- Computers (local runners) ----------

export interface Runner {
  id: string;
  name: string;
  platform: string;
  agents: AgentKind[];
  version: string | null;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AgentsResponse {
  cloud: {
    available: boolean;
    /** Cloud runs use the user's own Anthropic key (no daily limit from the server). */
    ownKey: boolean;
    budgetUsd: number;
    buildsPerDay: number;
  };
  runners: Runner[];
}

// ---------- Integrations (your own API keys and services) ----------

export const INTEGRATION_PROVIDERS = ["anthropic", "github"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export interface Integration {
  provider: IntegrationProvider;
  /** What identifies the connection without revealing it: "…x7Qa" or a GitHub login. */
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface IntegrationsResponse {
  /** False when the server has no encryption key configured for stored secrets. */
  available: boolean;
  integrations: Integration[];
}

export const ConnectIntegrationBody = z.object({ secret: z.string().trim().min(10).max(500) });

export const PublishRunBody = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,100}$/, "Letters, digits, dots, dashes and underscores")
    .optional(),
  private: z.boolean().default(true),
});
export type PublishRunBody = z.input<typeof PublishRunBody>;

export const RenameRunnerBody = z.object({ name: z.string().trim().min(1).max(60) });

/** Device pairing, like `gh auth login`: the CLI shows a code, the signed-in user approves it. */
export const USER_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const UserCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2"))
  .pipe(z.string().regex(USER_CODE_PATTERN));

export interface PairingInfo {
  userCode: string;
  name: string;
  platform: string;
  expiresAt: string;
}

export const ApprovePairingBody = z.object({ userCode: UserCodeSchema });

// ---------- Runner protocol (the `lightbulb` CLI talks to these) ----------

export const RunnerPairBody = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.string().trim().max(40).default("unknown"),
});

export interface RunnerPairResponse {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  /** Seconds between polls. */
  interval: number;
  expiresIn: number;
}

export const RunnerPairPollBody = z.object({ deviceCode: z.string().min(20).max(200) });

export type RunnerPairPollResponse =
  | { status: "pending" }
  | { status: "approved"; token: string; runner: { id: string; name: string }; email: string }
  | { status: "expired" };

export const RunnerHelloBody = z.object({
  agents: z.array(z.enum(AGENT_KINDS)).max(AGENT_KINDS.length),
  version: z.string().max(40),
  platform: z.string().max(40),
});

export interface RunnerHelloResponse {
  runner: { id: string; name: string };
  email: string;
}

export interface RunnerTask {
  runId: string;
  /** Proves the runner still holds the task; required on every report. */
  leaseId: string;
  stage: RunStage;
  agent: AgentKind;
  /** Language the user reads; agents write options and plans in it. */
  locale: Locale;
  idea: {
    id: string;
    title: string;
    body: string;
    steps: { text: string; done: boolean }[];
    notes: string[];
    files: { id: string; name: string; mime: string; sizeBytes: number }[];
  };
  choice: (RunChoice & { option: AgentOption }) | null;
  plan: AgentPlan | null;
  /** The user's change request when the plan is being revised. */
  revision: string | null;
  /** Folder name for the project on the runner's computer. */
  projectSlug: string;
  /** For "prompt": the user's instruction. */
  prompt: string | null;
  /** The project's own folder on the user's computer, when it lives in an existing repo. */
  projectPath: string | null;
  /** The latest saved project zip, so a computer without the folder can restore it first. */
  archive: { id: string; name: string; sizeBytes: number } | null;
  /** Earlier prompts on this project and what came of them, oldest first. */
  history: { prompt: string; summary: string | null; at: string }[];
}

export interface RunnerClaimResponse {
  task: RunnerTask | null;
}

const LeaseId = z.uuid();

export const RunnerHeartbeatBody = z.object({ leaseId: LeaseId });
export const RunnerProgressBody = z.object({
  leaseId: LeaseId,
  lines: z.array(z.string().max(500)).max(20),
});
export const RunnerOutputBody = z.object({ leaseId: LeaseId, output: z.unknown() });
export const RunnerResultBody = z.object({
  leaseId: LeaseId,
  output: z.unknown(),
  location: z.string().max(500).nullable(),
  /** The project zip uploaded with POST /runner/runs/:id/archive, if the runner made one. */
  archiveFileId: z.uuid().nullable().optional(),
});
export const RUNNER_FAIL_CODES = ["agent_missing", "auth", "invalid_output", "timeout", "failed"] as const;
export const RunnerFailBody = z.object({
  leaseId: LeaseId,
  message: z.string().max(2000),
  code: z.enum(RUNNER_FAIL_CODES).default("failed"),
});

/** Every report answers with this, so a runner learns promptly that the user cancelled. */
export interface RunnerAck {
  ok: boolean;
  cancelled: boolean;
}
