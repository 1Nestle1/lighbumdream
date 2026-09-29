import { and, eq, gt, isNull } from "drizzle-orm";
import type { ConfirmIdeaBody, Folder, FolderChoice, Idea, Locale } from "@lightbulb/shared";
import { db } from "../db/client.js";
import { telegramLinkCodes, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/tokens.js";

const LINK_TTL_MS = 10 * 60 * 1000;

/** One-time code for t.me/<bot>?start=<code>. Base64url fits Telegram's start-parameter alphabet. */
export async function createLinkCode(userId: string) {
  const code = randomToken().slice(0, 32);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await db.insert(telegramLinkCodes).values({ userId, codeHash: sha256(code), expiresAt });
  return { code, expiresAt };
}

/** Redeems a link code for a Telegram account. Returns the linked account, or null. */
export async function redeemLinkCode(
  code: string,
  telegramId: number,
): Promise<{ email: string; locale: Locale } | null> {
  return db.transaction(async (tx) => {
    const [link] = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(telegramLinkCodes.codeHash, sha256(code)),
          isNull(telegramLinkCodes.usedAt),
          gt(telegramLinkCodes.expiresAt, new Date()),
        ),
      )
      .returning({ userId: telegramLinkCodes.userId });
    if (!link) return null;
    // A Telegram account belongs to one web account at a time.
    await tx.update(users).set({ telegramId: null }).where(eq(users.telegramId, telegramId));
    const [user] = await tx
      .update(users)
      .set({ telegramId })
      .where(eq(users.id, link.userId))
      .returning({ email: users.email, locale: users.locale });
    return user ?? null;
  });
}

export async function findUserByTelegramId(telegramId: number) {
  const [user] = await db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.telegramId, telegramId));
  return user ?? null;
}

export async function isTelegramLinked(userId: string) {
  const [user] = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, userId));
  return Boolean(user?.telegramId);
}

export async function unlinkTelegram(userId: string) {
  await db.update(users).set({ telegramId: null }).where(eq(users.id, userId));
}

/** The folder options for an inbox idea, adjusted for folders created or deleted since the suggestion. */
export function suggestionChoices(idea: Idea, folders: Folder[]): FolderChoice[] {
  if (!idea.suggestion) return [];
  const seen = new Set<string>();
  const out: FolderChoice[] = [];
  for (const choice of [idea.suggestion.primary, ...idea.suggestion.alternatives]) {
    const live =
      choice.kind === "existing"
        ? folders.find((f) => f.id === choice.folderId)
        : folders.find((f) => f.name.toLowerCase() === choice.name.toLowerCase());
    const resolved: FolderChoice = live
      ? { kind: "existing", folderId: live.id, name: live.name, icon: live.icon }
      : { kind: "new", name: choice.name, icon: choice.icon };
    const key = resolved.kind === "existing" ? resolved.folderId : `new:${resolved.name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(resolved);
    }
  }
  return out;
}

export const choiceToTarget = (choice: FolderChoice): ConfirmIdeaBody["target"] =>
  choice.kind === "existing"
    ? { kind: "existing", folderId: choice.folderId }
    : { kind: "new", name: choice.name, icon: choice.icon };
