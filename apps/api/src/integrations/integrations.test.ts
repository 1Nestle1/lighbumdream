import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto.js";
import { projectFiles } from "./github.js";

describe("secret encryption", () => {
  it("round-trips and never stores the plain value", () => {
    const secret = "test-only-value-not-a-key-x7Qa";
    const stored = encryptSecret(secret);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("test-only");
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("uses a fresh IV each time and rejects tampering", () => {
    const a = encryptSecret("same");
    expect(encryptSecret("same")).not.toBe(a);
    const raw = Buffer.from(a.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`)).toThrow();
  });

  it("masks to the last four characters", () => {
    expect(maskSecret("test-value-abcdefgh1234")).toBe("…1234");
  });
});

describe("projectFiles", () => {
  const zip = (files: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
  const paths = (files: Record<string, string>) => projectFiles(zip(files)).map((f) => f.path).sort();

  it("keeps the project and drops dependencies, secrets and scratch files", () => {
    expect(
      paths({
        "README.md": "# Bot",
        "src/bot.ts": "x",
        ".env": "TOKEN=secret",
        ".env.local": "TOKEN=secret",
        ".env.example": "TOKEN=",
        "node_modules/grammy/index.js": "x",
        ".lightbulb/plan.md": "x",
        ".git/HEAD": "x",
        "debug.log": "x",
      }),
    ).toEqual([".env.example", "README.md", "src/bot.ts"]);
  });

  it("unwraps a single top-level folder", () => {
    expect(paths({ "gym-bot/README.md": "x", "gym-bot/src/a.ts": "x" })).toEqual(["README.md", "src/a.ts"]);
  });
});
