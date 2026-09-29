import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import type { RunnerPairPollResponse, RunnerPairResponse } from "@lightbulb/shared";
import { AGENT_LABELS } from "@lightbulb/shared/constants";
import { detectAgents } from "./agents.js";
import { ApiError, createApi } from "./api.js";
import {
  VERSION,
  configPath,
  defaultServer,
  loadConfig,
  normalizeServer,
  saveConfig,
  workspaceDir,
  type Config,
} from "./config.js";
import { c, log } from "./log.js";
import { defaultComputerName, platformName, runWorker } from "./worker.js";

const HELP = `${c.bold("Lightbulb runner")} ${VERSION}
Runs the ideas you send from Lightbulb with the coding agents on this computer
(Claude Code, Codex, Cursor CLI or Gemini CLI). Nothing runs until you approve a plan.

${c.bold("Usage")}
  lightbulb              Connect this computer if needed, then take ideas
  lightbulb login        Connect this computer to your Lightbulb account
  lightbulb run          Take ideas and run them (keep the window open)
  lightbulb status       Show the connection, projects folder and agents found
  lightbulb logout       Disconnect this computer

${c.bold("Options")}
  --server <url>         Your Lightbulb site (for login)
  --name <name>          Name shown for this computer (for login)
  --workspace <dir>      Folder for projects (default: ~/Lightbulb)

Settings live in ${configPath()}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function openBrowser(url: string) {
  // rundll32 opens the default browser on Windows without cmd.exe quoting rules.
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true })
      .on("error", () => {})
      .unref();
  } catch {
    // The link is printed as well.
  }
}

async function login(config: Config, options: { server?: string; name?: string }): Promise<Config> {
  const serverInput = options.server ?? config.server ?? defaultServer();
  if (!serverInput) throw new Error("Which Lightbulb site? Pass it with --server https://your-lightbulb-site");
  const server = normalizeServer(serverInput);
  const api = createApi(server);
  const name = (options.name ?? config.name ?? defaultComputerName()).trim().slice(0, 60);

  const pairing = await api.post<RunnerPairResponse>("/runner/pair", { name, platform: platformName() });
  log.plain();
  log.plain(`  To connect ${c.bold(name)}, open this page and confirm the code:`);
  log.plain();
  log.plain(`    ${c.cyan(pairing.verifyUrl)}`);
  log.plain(`    Code: ${c.bold(c.yellow(pairing.userCode))}`);
  log.plain();
  openBrowser(pairing.verifyUrl);

  const deadline = Date.now() + pairing.expiresIn * 1000;
  process.stdout.write(c.dim("  Waiting for you to confirm…"));
  while (Date.now() < deadline) {
    await sleep(pairing.interval * 1000);
    let answer: RunnerPairPollResponse;
    try {
      answer = await api.post<RunnerPairPollResponse>("/runner/pair/poll", { deviceCode: pairing.deviceCode });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) continue;
      throw err;
    }
    if (answer.status === "pending") continue;
    process.stdout.write("\n");
    if (answer.status === "expired") throw new Error("The code expired. Run `lightbulb login` again.");
    const next: Config = { ...config, server, token: answer.token, runnerId: answer.runner.id, name: answer.runner.name, email: answer.email };
    await saveConfig(next);
    log.ok(`Connected as ${c.bold(answer.runner.name)} (${answer.email}).`);
    return next;
  }
  process.stdout.write("\n");
  throw new Error("The code expired. Run `lightbulb login` again.");
}

async function run(config: Config) {
  if (!config.server || !config.token) throw new Error("This computer isn't connected yet. Run `lightbulb login`.");
  log.info(c.dim("Looking for agent CLIs…"));
  const agents = detectAgents();
  const stop = new AbortController();
  let stops = 0;
  process.on("SIGINT", () => {
    stops += 1;
    if (stops > 1) process.exit(130);
    log.warn("Stopping… (press Ctrl+C again to quit at once)");
    stop.abort();
  });
  await runWorker(createApi(config.server, config.token), config, agents, stop.signal);
  log.info("Stopped.");
}

async function status(config: Config) {
  const agents = detectAgents();
  log.plain(`${c.bold("Lightbulb runner")} ${VERSION}`);
  log.plain(`  Site       ${config.server ?? c.dim("not connected")}`);
  log.plain(`  Computer   ${config.token ? `${config.name} ${c.dim(`(${config.email})`)}` : c.dim("not connected")}`);
  log.plain(`  Projects   ${workspaceDir(config)}`);
  log.plain(`  Agents     ${agents.length ? agents.map((a) => `${AGENT_LABELS[a.kind]} ${c.dim(a.version)}`).join(", ") : c.red("none found")}`);
  log.plain(`  Settings   ${configPath()}`);
}

async function logout(config: Config) {
  if (config.server && config.token) {
    await createApi(config.server, config.token)
      .post("/runner/logout", {})
      .catch(() => {});
  }
  const { token: _token, runnerId: _runnerId, email: _email, ...rest } = config;
  await saveConfig(rest);
  log.ok("This computer is disconnected.");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      server: { type: "string" },
      name: { type: "string" },
      workspace: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) return log.plain(VERSION);
  const command = positionals[0] ?? "start";
  if (values.help || command === "help") return log.plain(HELP);

  let config = await loadConfig();
  if (values.workspace) {
    config = { ...config, workspace: values.workspace };
    await saveConfig(config);
  }

  switch (command) {
    case "login":
      await login(config, values);
      log.plain(`\n  Next: run ${c.bold("lightbulb run")} and keep it open while you use Lightbulb.`);
      return;
    case "run":
      return run(config);
    case "start":
      if (!config.token) config = await login(config, values);
      return run(config);
    case "status":
      return status(config);
    case "logout":
      return logout(config);
    default:
      log.plain(HELP);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
