import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env, isProd } from "../env.js";

// Users' API keys and tokens are encrypted at rest with AES-256-GCM. The key comes from
// SECRETS_KEY; in development a random one is created once and kept with the uploads
// (DATA_DIR is git-ignored) so stored keys survive restarts.

const VERSION = "v1";
let cached: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (env.SECRETS_KEY) return createHash("sha256").update(env.SECRETS_KEY).digest();
  if (isProd) return null;
  const file = path.resolve(env.DATA_DIR, ".secrets-key");
  try {
    return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  } catch {
    const key = randomBytes(32);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, key.toString("base64"), { mode: 0o600 });
    return key;
  }
}

const secretsKey = () => (cached === undefined ? (cached = loadKey()) : cached);

/** False in production without SECRETS_KEY: nothing can be stored safely. */
export const secretsAvailable = () => secretsKey() !== null;

export function encryptSecret(plain: string): string {
  const key = secretsKey();
  if (!key) throw new Error("SECRETS_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const key = secretsKey();
  if (!key) throw new Error("SECRETS_KEY is not configured");
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown secret format");
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Shows enough to recognise a key without revealing it: "…x7Qa". */
export const maskSecret = (secret: string) => `…${secret.slice(-4)}`;
