import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  customType,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import type {
  AgentKind,
  AgentOption,
  AgentPlan,
  AgentResult,
  FolderIcon,
  IntegrationProvider,
  Locale,
  RunChoice,
  RunError,
  RunEventKind,
  RunKind,
  RunStatus,
  Suggestion,
} from "@lightbulb/shared";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});

// Millisecond precision so JS Dates round-trip exactly (keyset pagination relies on it).
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Telegram user ids fit in 52 bits, so a JS number is safe.
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  /** Interface language; also used for the bot, emails and as the default speech language. */
  locale: text("locale").$type<Locale>().notNull().default("en"),
  createdAt: createdAt(),
});

export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** Language of the sign-in page the link was requested from; applied to the account on sign-in. */
    locale: text("locale").$type<Locale>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("magic_links_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").$type<FolderIcon>().notNull().default("Folder"),
    /** True when the folder was created by accepting a suggestion. */
    autoCreated: boolean("auto_created").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("folders_user_name_uq").on(t.userId, sql`lower(${t.name})`)],
);

export const ideaStatus = pgEnum("idea_status", ["inbox", "filed"]);

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: ideaStatus("status").notNull().default("inbox"),
    suggestion: jsonb("suggestion").$type<Suggestion>(),
    /** Cache of the first unchecked step, kept in sync by the notebook service. */
    nextStep: text("next_step"),
    hasAudio: boolean("has_audio").notNull().default(false),
    /** Set when the user stars the idea as a favourite project; favourites lead the projects board. */
    favoriteAt: timestamp("favorite_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // 'simple' config: no stemming, works for any language the user writes in.
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${ideas.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${ideas.body}, '')), 'B')`,
    ),
  },
  (t) => [
    index("ideas_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("ideas_user_folder_idx").on(t.userId, t.folderId),
    index("ideas_search_idx").using("gin", t.search),
    index("ideas_user_favorite_idx").on(t.userId, t.favoriteAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type IdeaRow = typeof ideas.$inferSelect;

/** Voice recordings. Uploaded before the idea exists, attached when it's saved. */
export const audioClips = pgTable(
  "audio_clips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "cascade" }),
    /** Set instead of ideaId when the recording is a voice note on an idea page. */
    noteId: uuid("note_id").references(() => ideaNotes.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    data: bytea("data").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    transcript: text("transcript").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audio_clips_idea_idx").on(t.ideaId),
    index("audio_clips_note_idx").on(t.noteId),
    index("audio_clips_user_idx").on(t.userId),
  ],
);

/** One-time codes that link a Telegram account to a web account via the bot's /start. */
export const telegramLinkCodes = pgTable("telegram_link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Idea page ----------
// Deliberately restricted: a capped checklist, short notes and attachments. No free-form documents.

/** Checklist on an idea. The first unchecked step (by position) is the idea's next step. */
export const ideaSteps = pgTable(
  "idea_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    position: integer("position").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idea_steps_idea_idx").on(t.ideaId, t.position)],
);

/** Short notes added to an idea over time (typed or voice). */
export const ideaNotes = pgTable(
  "idea_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("idea_notes_idea_idx").on(t.ideaId, t.createdAt)],
);

/** Photos and files attached to an idea. Bytes live in file storage under storageKey. */
export const ideaFiles = pgTable(
  "idea_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"image" | "file">().notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("idea_files_idea_idx").on(t.ideaId, t.createdAt), index("idea_files_user_idx").on(t.userId)],
);

// ---------- Agents ----------

/** A computer running the `lightbulb` CLI. It authenticates with a token issued at pairing. */
export const agentRunners = pgTable(
  "agent_runners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("unknown"),
    /** Agent CLIs found on the computer, reported each time the runner starts. */
    agents: jsonb("agents").$type<AgentKind[]>().notNull().default([]),
    version: text("version"),
    tokenHash: text("token_hash").notNull().unique(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_runners_user_idx").on(t.userId)],
);

/** Device pairing for the CLI (like `gh auth login`): the CLI polls with deviceCode, the user approves userCode. */
export const runnerPairings = pgTable("runner_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  /** Set when a signed-in user approves the code. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  /** Set once the CLI has collected its token; a pairing is single-use. */
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/**
 * One trip of an idea through options -> pick -> plan -> approve -> build.
 * status says whose turn it is; a lease marks the agent currently working on it.
 */
export const ideaRuns = pgTable(
  "idea_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    target: text("target").$type<"cloud" | "local">().notNull(),
    runnerId: uuid("runner_id").references(() => agentRunners.id, { onDelete: "set null" }),
    agent: text("agent").$type<AgentKind | "cloud">().notNull(),
    /** "loop": options, plan, approve, build. "prompt": one instruction from the user, run at once. */
    kind: text("kind").$type<RunKind>().notNull().default("loop"),
    prompt: text("prompt"),
    status: text("status").$type<RunStatus>().notNull(),
    options: jsonb("options").$type<AgentOption[]>(),
    choice: jsonb("choice").$type<RunChoice>(),
    plan: jsonb("plan").$type<AgentPlan>(),
    planVersion: integer("plan_version").notNull().default(0),
    revision: text("revision"),
    result: jsonb("result").$type<AgentResult>(),
    error: jsonb("error").$type<RunError>(),
    progress: jsonb("progress").$type<string[]>().notNull().default([]),
    leaseId: uuid("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** Claims of the current stage; a stage that keeps getting dropped fails instead of looping. */
    attempts: integer("attempts").notNull().default(0),
    /** Claude Managed Agents session of a cloud build, so a restarted worker can pick it back up. */
    cloudSessionId: text("cloud_session_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idea_runs_idea_idx").on(t.ideaId, t.createdAt.desc()),
    index("idea_runs_queue_idx").on(t.status, t.target, t.runnerId),
    // One run in flight per idea.
    uniqueIndex("idea_runs_active_uq")
      .on(t.ideaId)
      .where(sql`status in ('options_pending', 'options_ready', 'plan_pending', 'plan_ready', 'building')`),
  ],
);

/** What happened on a run, shown as its history. */
export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ideaRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<RunEventKind>().notNull(),
    text: text("text"),
    createdAt: createdAt(),
  },
  (t) => [index("run_events_run_idx").on(t.runId, t.createdAt), index("run_events_user_idx").on(t.userId, t.kind, t.createdAt)],
);

/**
 * A user's own API keys and service tokens (Anthropic, GitHub). The secret is encrypted with
 * SECRETS_KEY (AES-256-GCM) and never sent back to any client; `label` is what the UI shows.
 */
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    secret: text("secret").notNull(),
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_credentials_user_provider_uq").on(t.userId, t.provider)],
);

/** Small server-wide values, such as the ids of the provisioned cloud agent. */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export type IdeaRunRow = typeof ideaRuns.$inferSelect;
export type RunnerRow = typeof agentRunners.$inferSelect;
