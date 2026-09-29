import { createHash, randomBytes } from "node:crypto";

/** URL-safe random token. Only its hash is ever stored. */
export const randomToken = () => randomBytes(32).toString("base64url");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
