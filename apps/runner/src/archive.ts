import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

// After a build, the project folder is zipped and saved to the idea, so it can be downloaded
// from anywhere and published to GitHub. Dependencies, build output and secrets stay behind.

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

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 2000;

/** The project as a zip, or null when it's empty or wouldn't fit in `maxBytes`. */
export async function zipProject(dir: string, maxBytes: number): Promise<Buffer | null> {
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;

  async function walk(rel: string): Promise<boolean> {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !(await walk(relPath))) return false;
        continue;
      }
      // Symlinks and special files are skipped: only regular files are packed.
      if (!entry.isFile() || isSecretFile(entry.name) || isJunk(entry.name)) continue;
      const full = path.join(dir, relPath);
      const { size } = await stat(full);
      if (size > MAX_FILE_BYTES) continue;
      count += 1;
      total += size;
      // Text compresses well, but a project several times the limit won't fit anyway.
      if (count > MAX_FILES || total > maxBytes * 4) return false;
      files[relPath] = await readFile(full);
    }
    return true;
  }

  if (!(await walk("")) || count === 0) return null;
  const zipped = Buffer.from(zipSync(files, { level: 6 }));
  return zipped.length <= maxBytes ? zipped : null;
}
