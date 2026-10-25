import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import type { RunnerPairPollResponse, RunnerPairResponse } from "@lightbulb/shared";
import { AGENT_LABELS } from "@lightbulb/shared/constants";
import { detectAgents } from "./agents.js";
import { ApiError, createApi } from "./api.js";
import { VERSION, configPath, loadConfig, pickServer, saveConfig, workspaceDir, type Config } from "./config.js";
import { c, log } from "./log.js";
import { defaultComputerName, platformName, runWorker } from "./worker.js";

const HELP = `${c.bold("Lightbulb runner")} ${VERSION}
Runs the ideas you send from Lightbulb with the coding agents on this computer
(Claude Code, Codex, Cursor CLI or Gemini CLI). Nothing runs until you approve a plan.

${c.bold("Usage")}
  lightbulb              Connect this computer if needed, then take ideas
  lightbulb login        Connect this computer to your Lightbulb account
  lightbulb run          Take ideas and run them (keep the window open)
  lightbulb status       Show the connections, projects folder and agents found
  lightbulb logout       Disconnect this computer from the site

${c.bold("Options")}
  --server <url>         Which Lightbulb site (default: the one this file came from)
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

function requireServer(config: Config, flag?: string): string {
  const server = pickServer(config, flag);
  if (!server) throw new Error("Which Lightbulb site? Pass it with --server https://your-lightbulb-site");
  return server;
}

async function login(config: Config, options: { server?: string; name?: string }): Promise<Config> {
  const server = requireServer(config, options.server);
  const api = createApi(server);
  const known = Object.values(config.servers ?? {}).find((conn) => conn.name)?.name;
  const name = (options.name ?? known ?? defaultComputerName()).trim().slice(0, 60);

  const pairing = await api.post<RunnerPairResponse>("/runner/pair", { name, platform: platformName() });
  log.plain();
  log.plain(`  To connect ${c.bold(name)} to ${c.cyan(server)}, open this page and confirm the code:`);
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
    const next: Config = {
      ...config,
      servers: {
        ...config.servers,
        [server]: { token: answer.token, runnerId: answer.runner.id, name: answer.runner.name, email: answer.email },
      },
      lastServer: server,
    };
    await saveConfig(next);
    log.ok(`Connected as ${c.bold(answer.runner.name)} (${answer.email}).`);
    return next;
  }
  process.stdout.write("\n");
  throw new Error("The code expired. Run `lightbulb login` again.");
}

async function run(config: Config, flag?: string) {
  const server = requireServer(config, flag);
  const connection = config.servers?.[server];
  if (!connection) throw new Error(`This computer isn't connected to ${server} yet. Run \`lightbulb login\`.`);
  if (config.lastServer !== server) await saveConfig({ ...config, lastServer: server });

  log.info(c.dim(`Site: ${server}`));
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
  await runWorker(createApi(server, connection.token), config, agents, stop.signal);
  log.info("Stopped.");
}

async function status(config: Config, flag?: string) {
  const agents = detectAgents();
  const current = pickServer(config, flag);
  const servers = Object.entries(config.servers ?? {});
  log.plain(`${c.bold("Lightbulb runner")} ${VERSION}`);
  log.plain(`  Site       ${current ?? c.dim("none chosen")}`);
  if (servers.length) {
    for (const [server, conn] of servers) {
      log.plain(`  ${server === current ? c.green("●") : " "} ${server}  ${conn.name ?? ""} ${c.dim(`(${conn.email ?? "?"})`)}`);
    }
  } else {
    log.plain(`  Computer   ${c.dim("not connected")}`);
  }
  log.plain(`  Projects   ${workspaceDir(config)}`);
  log.plain(`  Agents     ${agents.length ? agents.map((a) => `${AGENT_LABELS[a.kind]} ${c.dim(a.version)}`).join(", ") : c.red("none found")}`);
  log.plain(`  Settings   ${configPath()}`);
}

async function logout(config: Config, flag?: string) {
  const server = requireServer(config, flag);
  const connection = config.servers?.[server];
  if (connection) {
    await createApi(server, connection.token)
      .post("/runner/logout", {})
      .catch(() => {});
  }
  const servers = { ...config.servers };
  delete servers[server];
  await saveConfig({ ...config, servers });
  log.ok(`This computer is disconnected from ${server}.`);
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
  // Saves the moved pre-0.2 settings and any new workspace.
  if (values.workspace) config = { ...config, workspace: values.workspace };
  await saveConfig(config);

  switch (command) {
    case "login":
      await login(config, values);
      log.plain(`\n  Next: run ${c.bold("lightbulb run")} and keep it open while you use Lightbulb.`);
      return;
    case "run":
      return run(config, values.server);
    case "start": {
      const server = requireServer(config, values.server);
      if (!config.servers?.[server]) config = await login(config, values);
      return run(config, server);
    }
    case "status":
      return status(config, values.server);
    case "logout":
      return logout(config, values.server);
    default:
      log.plain(HELP);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
