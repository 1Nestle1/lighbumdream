import { spawn as nodeSpawn } from "node:child_process";
import spawn from "cross-spawn";

// cross-spawn resolves npm's .cmd shims on Windows (codex, gemini, cursor-agent) and quotes
// arguments for cmd.exe. Prompts go through stdin or a file, never the command line.

export interface ProcessOptions {
  cwd: string;
  stdin?: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Called for each complete stdout line, for agents that stream JSON events. */
  onLine?: (line: string) => void;
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  /** Set when the process could not start at all (usually: not installed). */
  error?: Error;
}

const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 256 * 1024;
const keepTail = (buffer: string, chunk: string, max: number) => {
  const next = buffer + chunk;
  return next.length > max ? next.slice(next.length - max) : next;
};

/** Stops the process and everything it started (agents spawn shells, dev servers, ...). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") {
    nodeSpawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // already gone
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, 5_000).unref();
}

export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group on macOS/Linux, so the whole tree can be stopped.
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let partial = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = keepTail(stdout, chunk, MAX_STDOUT);
      if (!options.onLine) return;
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) options.onLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = keepTail(stderr, chunk, MAX_STDERR);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      killTree(child.pid);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      if (options.onLine && partial.trim()) options.onLine(partial);
      resolve({ code, stdout, stderr, timedOut, aborted, error });
    };
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));

    child.stdin?.on("error", () => {}); // the agent may exit before reading everything
    child.stdin?.end(options.stdin ?? "");
  });
}

/** Runs a quick command (like `--version`) and returns its output, or null if it isn't there. */
export function probe(command: string, args: string[]): string | null {
  const result = spawn.sync(command, args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}
