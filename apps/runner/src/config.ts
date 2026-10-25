import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentKind } from "@lightbulb/shared";

export const VERSION = "0.2.0";

/** Replaced with the site's address when the Lightbulb server hands out this file. */
const BAKED_SERVER = "__LIGHTBULB_SERVER__";
const bakedServer = (): string | null => (BAKED_SERVER.startsWith("__") ? null : BAKED_SERVER);

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

/** This computer's connection to one Lightbulb site. */
export interface Connection {
  token: string;
  runnerId?: string;
  name?: string;
  email?: string;
}

export interface Config {
  /** One connection per site (keyed by origin), so a local copy and a server can both be used. */
  servers?: Record<string, Connection>;
  /** The site used last, the fallback when nothing else says which one. */
  lastServer?: string;
  /** Where each idea's project folder is created. */
  workspace?: string;
  agents?: Partial<Record<AgentKind, AgentSettings>>;
  buildTimeoutMinutes?: number;
  /** Before 0.2 the file held a single connection at the top level; it's moved into `servers`. */
  server?: string;
  token?: string;
  runnerId?: string;
  name?: string;
  email?: string;
}

export const configDir = () => process.env.LIGHTBULB_HOME ?? path.join(os.homedir(), ".lightbulb");
export const configPath = () => path.join(configDir(), "config.json");

export const normalizeServer = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const parsed = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  return parsed.origin;
};

export async function loadConfig(): Promise<Config> {
  let config: Config;
  try {
    config = JSON.parse(await readFile(configPath(), "utf8")) as Config;
  } catch {
    return {};
  }
  // Move a pre-0.2 single connection into `servers`.
  if (config.server && config.token) {
    const server = normalizeServer(config.server);
    const { token, runnerId, name, email } = config;
    config = {
      ...config,
      servers: { ...config.servers, [server]: { token, runnerId, name, email } },
      lastServer: config.lastServer ?? server,
    };
  }
  delete config.server;
  delete config.token;
  delete config.runnerId;
  delete config.email;
  delete config.name;
  return config;
}

/** The file holds this computer's tokens, so only its owner may read it. */
export async function saveConfig(config: Config) {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(configPath(), 0o600).catch(() => {});
}

/**
 * Which site to talk to: --server, then LIGHTBULB_SERVER, then the site this file was downloaded
 * from, then the one used last.
 */
export function pickServer(config: Config, flag?: string): string | null {
  const choice = flag ?? process.env.LIGHTBULB_SERVER ?? bakedServer() ?? config.lastServer;
  return choice ? normalizeServer(choice) : null;
}

export const workspaceDir = (config: Config) => path.resolve(config.workspace ?? path.join(os.homedir(), "Lightbulb"));
