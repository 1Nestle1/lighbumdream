import { unzipSync } from "fflate";
import { HttpError } from "../lib/http.js";

// Publishing a finished project to GitHub through the REST API, so the server needs no git:
// create the repository (with an initial commit, since the Git Data API refuses empty repos),
// upload every file as a blob, build one tree, commit it, and move the branch to that commit.

const API = "https://api.github.com";
const MAX_FILES = 1000;

/** Never published: dependencies, build output, local secrets, Lightbulb's own scratch files. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".lightbulb",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);
const isSecretFile = (name: string) => /^\.env(\..+)?$/.test(name) && name !== ".env.example";
const isJunk = (name: string) => name === ".DS_Store" || name === "Thumbs.db" || name.endsWith(".log");

/**
 * The files of a project zip that belong in a repository, with paths relative to the project.
 * A zip whose entries all sit in one top folder ("my-app/...") is unwrapped.
 */
export function projectFiles(zip: Uint8Array): { path: string; data: Uint8Array }[] {
  const entries = Object.entries(unzipSync(zip))
    .map(([path, data]) => ({ path: path.replace(/\\/g, "/").replace(/^\.?\//, ""), data }))
    .filter(({ path }) => path && !path.endsWith("/"));

  const tops = new Set(entries.map(({ path }) => path.split("/")[0]));
  const [onlyTop] = [...tops];
  const unwrap = tops.size === 1 && entries.every(({ path }) => path.includes("/"));

  return entries
    .map(({ path, data }) => ({ path: unwrap ? path.slice(onlyTop!.length + 1) : path, data }))
    .filter(({ path }) => {
      const parts = path.split("/");
      const name = parts.at(-1)!;
      return (
        !parts.some((part) => part === ".." || SKIP_DIRS.has(part)) && !isSecretFile(name) && !isJunk(name)
      );
    });
}

async function github<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "lightbulb",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string; errors?: { message?: string }[] } | null;
    const detail = [data?.message, ...(data?.errors ?? []).map((e) => e.message)].filter(Boolean).join(": ");
    throw Object.assign(new Error(detail || `GitHub answered ${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
}

const statusOf = (err: unknown) => (err as { status?: number }).status;

/** Checks a token; GitHub's answer gives the login to show for the connection. */
export async function githubUser(token: string): Promise<{ login: string }> {
  try {
    return await github<{ login: string }>(token, "GET", "/user");
  } catch (err) {
    if (statusOf(err) === 401 || statusOf(err) === 403) {
      throw new HttpError(400, "invalid_key", "GitHub didn't accept that token");
    }
    throw new HttpError(502, "provider_unreachable", "Couldn't reach GitHub to check the token");
  }
}

interface Repo {
  full_name: string;
  html_url: string;
  default_branch: string;
}

/** Creates the repository, trying name-2, name-3... when the name is taken. */
async function createRepo(token: string, name: string, description: string, isPrivate: boolean): Promise<Repo> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const candidate = attempt === 1 ? name : `${name}-${attempt}`;
    try {
      return await github<Repo>(token, "POST", "/user/repos", {
        name: candidate,
        description,
        private: isPrivate,
        auto_init: true,
      });
    } catch (err) {
      const taken = statusOf(err) === 422 && /already exists/i.test((err as Error).message);
      if (!taken) throw err;
    }
  }
  throw new HttpError(409, "github_failed", "Couldn't find a free repository name");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function publishProject(
  token: string,
  repo: { name: string; description: string; private: boolean },
  zip: Uint8Array,
): Promise<{ url: string; fullName: string }> {
  const files = projectFiles(zip);
  if (!files.length) throw new HttpError(422, "no_project_zip", "The project zip has no files to publish");
  if (files.length > MAX_FILES) throw new HttpError(422, "github_failed", `Too many files to publish (${files.length})`);

  try {
    const created = await createRepo(token, repo.name, repo.description, repo.private);
    const base = `/repos/${created.full_name}`;

    // The initial commit from auto_init can take a moment to appear.
    let parent = "";
    for (let i = 0; i < 5 && !parent; i++) {
      try {
        parent = (await github<{ object: { sha: string } }>(token, "GET", `${base}/git/ref/heads/${created.default_branch}`))
          .object.sha;
      } catch (err) {
        if (i === 4) throw err;
        await sleep(1000);
      }
    }

    // Blobs, four at a time.
    const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    for (let i = 0; i < files.length; i += 4) {
      const batch = await Promise.all(
        files.slice(i, i + 4).map(async (file) => {
          const blob = await github<{ sha: string }>(token, "POST", `${base}/git/blobs`, {
            content: Buffer.from(file.data).toString("base64"),
            encoding: "base64",
          });
          return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
        }),
      );
      tree.push(...batch);
    }

    const newTree = await github<{ sha: string }>(token, "POST", `${base}/git/trees`, { tree });
    const commit = await github<{ sha: string }>(token, "POST", `${base}/git/commits`, {
      message: "First version, built with Lightbulb",
      tree: newTree.sha,
      parents: [parent],
    });
    await github(token, "PATCH", `${base}/git/refs/heads/${created.default_branch}`, { sha: commit.sha });
    return { url: created.html_url, fullName: created.full_name };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const status = statusOf(err);
    if (status === 401) throw new HttpError(400, "invalid_key", "GitHub didn't accept the saved token. Connect it again.");
    if (status === 403 || status === 404) {
      throw new HttpError(403, "github_failed", "The GitHub token can't create repositories or write to them. Check its permissions.");
    }
    throw new HttpError(502, "github_failed", `GitHub refused: ${(err as Error).message}`);
  }
}
