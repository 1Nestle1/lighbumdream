import { randomInt, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Passwords are stored as scrypt hashes: "scrypt$N$r$p$salt$hash" (salt and hash in base64url).
// The parameters travel with the hash, so they can be raised later without breaking old ones.

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, options: ScryptOptions, length: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, length, { ...options, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P }, KEY_LENGTH);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) }, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to compare against when the account doesn't exist, so timing doesn't reveal that. */
export const DUMMY_HASH = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA$" + "A".repeat(86);

/** 24 characters in four groups, no look-alikes (0/O, 1/l/I): about 140 bits. */
export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(""),
  );
  return groups.join("-");
}
