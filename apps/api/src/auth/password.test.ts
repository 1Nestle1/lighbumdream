import { describe, expect, it } from "vitest";
import { DUMMY_HASH, generatePassword, hashPassword, verifyPassword } from "./password.js";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(stored).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("never matches the placeholder used for unknown accounts or malformed hashes", async () => {
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });

  it("generates long passwords without look-alike characters", () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z2-9]{6}(-[A-Za-z2-9]{6}){3}$/);
    expect(password).not.toMatch(/[01OIl]/);
    expect(generatePassword()).not.toBe(password);
  });
});
