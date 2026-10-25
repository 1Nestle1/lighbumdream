import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VERSION } from "./config.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** "fetch failed" says nothing; the cause (refused, DNS, TLS, timeout) does. */
function networkReason(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code === "ECONNREFUSED") return "nothing is answering there (is it running?)";
  if (cause?.code === "ENOTFOUND") return "the address doesn't exist";
  if ((err as Error)?.name === "TimeoutError") return "it took too long to answer";
  return cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
}

interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type Api = ReturnType<typeof createApi>;

/** Talks to the Lightbulb API. The runner only ever makes outbound HTTPS requests. */
export function createApi(server: string, token?: string) {
  const headers = (json: boolean): Record<string, string> => ({
    "user-agent": `lightbulb-runner/${VERSION}`,
    ...(json && { "content-type": "application/json" }),
    ...(token && { authorization: `Bearer ${token}` }),
  });

  const signalFor = (options: CallOptions) => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  };

  async function call<T>(method: string, path: string, body: unknown, options: CallOptions): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${server}/api${path}`, {
        method,
        headers: headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signalFor(options),
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      throw new ApiError(0, "network", `Can't reach ${server}: ${networkReason(err)}`);
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      throw new ApiError(response.status, data?.error ?? "http_error", data?.message ?? `HTTP ${response.status}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  return {
    server,
    post: <T>(path: string, body: unknown = {}, options: CallOptions = {}) => call<T>("POST", path, body, options),
    get: <T>(path: string, options: CallOptions = {}) => call<T>("GET", path, undefined, options),
    /** Sends raw bytes (the project zip). */
    async upload<T>(path: string, data: Buffer, contentType: string, options: CallOptions = {}): Promise<T> {
      const response = await fetch(`${server}/api${path}`, {
        method: "POST",
        headers: { ...headers(false), "content-type": contentType },
        body: new Uint8Array(data),
        signal: signalFor({ timeoutMs: 5 * 60_000, ...options }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new ApiError(response.status, body?.error ?? "http_error", body?.message ?? `HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    },
    async download(path: string, destination: string, options: CallOptions = {}) {
      const response = await fetch(`${server}/api${path}`, {
        headers: headers(false),
        signal: signalFor({ timeoutMs: 5 * 60_000, ...options }),
      });
      if (!response.ok || !response.body) throw new ApiError(response.status, "download_failed", `HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(destination));
    },
  };
}
