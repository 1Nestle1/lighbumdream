import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentKind } from "@lightbulb/shared";

export const VERSION = "0.1.0";

/** Replaced with the site's address when the Lightbulb server hands out this file. */
const BAKED_SERVER = "__LIGHTBULB_SERVER__";

export const defaultServer = (): string | null =>
  process.env.LIGHTBULB_SERVER ?? (BAKED_SERVER.startsWith("__") ? null : BAKED_SERVER);

/** Per-agent overrides, edited by hand in the config file. */
export interface AgentSettings {
  model?: string;
  /** Claude Code: permission mode for builds (default acceptEdits). */
  permissionMode?: string;
  /** Claude Code: tools a build may use without asking. */
  allowedTools?: string[];
  /** Claude Code: spending cap per call, in US dollars. */
  maxBudgetUsd?: number;
  /** Codex: sandbox for builds (default workspace-write). */
  sandbox?: string;
  /** Gemini CLI: approval mode for builds (default auto_edit). */
  approvalMode?: string;
}

export interface Config {
  server?: string;
  token?: string;
  runnerId?: string;
  name?: string;
  email?: string;
  /** Where each idea's project folder is created. */
  workspace?: string;
  agents?: Partial<Record<AgentKind, AgentSettings>>;
  buildTimeoutMinutes?: number;
}

export const configDir = () => process.env.LIGHTBULB_HOME ?? path.join(os.homedir(), ".lightbulb");
export const configPath = () => path.join(configDir(), "config.json");

export async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as Config;
  } catch {
    return {};
  }
}

/** The file holds this computer's token, so only its owner may read it. */
export async function saveConfig(config: Config) {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(configPath(), 0o600).catch(() => {});
}

export const workspaceDir = (config: Config) => path.resolve(config.workspace ?? path.join(os.homedir(), "Lightbulb"));

export const normalizeServer = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const parsed = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  return parsed.origin;
};
