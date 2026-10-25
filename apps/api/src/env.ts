import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://lightbulb:lightbulb@localhost:5433/lightbulb"),
  API_PORT: z.coerce.number().int().default(3001),
  /** Interface to listen on. Use 127.0.0.1 behind a reverse proxy on a shared server. */
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  ANTHROPIC_API_KEY: z.string().optional(),
  SUGGEST_MODEL: z.string().default("claude-opus-5"),
  SMTP_URL: z.string().optional(),
  /** "false": nobody can create an account by signing in; the admin creates them (npm run admin). */
  ALLOW_SIGNUP: z.enum(["true", "false"]).default("true"),
  MAIL_FROM: z.string().default("Lightbulb <no-reply@lightbulb.local>"),
  /** Self-hosted whisper.cpp server (see docker-compose.yml). Audio never leaves your infrastructure. */
  WHISPER_URL: z.url().default("http://127.0.0.1:8081"),
  /** Where uploaded photos and files are stored (relative to the API's working directory). */
  DATA_DIR: z.string().default("data"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Public https URL of this API. When set, Telegram delivers updates by webhook; otherwise long polling. */
  TELEGRAM_WEBHOOK_URL: z.url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Cloud agent runs (needs ANTHROPIC_API_KEY). Set to "false" to offer only users' own computers. */
  CLOUD_AGENTS: z.enum(["true", "false"]).default("true"),
  /** Model for cloud options, plans and builds. */
  AGENT_MODEL: z.string().default("claude-opus-5"),
  /** Hard spending cap for one cloud build, in US dollars. */
  CLOUD_BUILD_BUDGET_USD: z.coerce.number().positive().max(500).default(5),
  /** Cloud builds each user may approve per 24 hours. */
  CLOUD_BUILDS_PER_DAY: z.coerce.number().int().min(0).default(3),
  /** Cloud tasks this server works on at once. */
  CLOUD_MAX_CONCURRENT: z.coerce.number().int().min(1).max(20).default(2),
  CLOUD_BUILD_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),
  /**
   * Encrypts users' own API keys and tokens at rest. Any long random string; changing it makes
   * stored keys unreadable (users reconnect). Required in production for integrations.
   */
  SECRETS_KEY: z.string().min(32).optional(),
  /** The built `lightbulb` CLI, served at /api/runner/cli (relative to the API's working directory). */
  RUNNER_BUNDLE: z.string().default("../runner/dist/lightbulb.cjs"),
});

// Empty strings in .env mean "unset".
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
);

export const env = EnvSchema.parse(raw);
export const isProd = env.NODE_ENV === "production";
