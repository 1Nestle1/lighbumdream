import { and, asc, desc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import {
  SNIPPET_MARK_END,
  SNIPPET_MARK_START,
  type ConfirmIdeaBody,
  type ConfirmIdeaResponse,
  type Idea,
  type IdeasResponse,
  type ListIdeasQuery as ListIdeasQuerySchema,
  type RelatedIdea,
  type UpdateIdeaBody,
} from "@lightbulb/shared";
import { z } from "zod";
import { db } from "../db/client.js";
import { folders, ideaSteps, ideas, users, type IdeaRow } from "../db/schema.js";
import { findOrCreateFolder, getFolder } from "../folders/service.js";
import { notFound } from "../lib/http.js";
import { escapeLike } from "../lib/pg.js";
import { tokenize } from "../lib/text.js";
import { suggestFolder } from "../suggest/index.js";
import type { SuggestInput } from "../suggest/types.js";
import { attachClip } from "../voice/service.js";
import { addFirstStep, storageKeysForIdea, syncNextStep } from "../notebook/service.js";
import { removeFiles } from "../storage/files.js";

type ListQuery = z.output<typeof ListIdeasQuerySchema>;

export const toIdea = (row: IdeaRow, snippet?: string | null): Idea => ({
  id: row.id,
  title: row.title,
  body: row.body,
  status: row.status,
  folderId: row.folderId,
  suggestion: row.suggestion,
  nextStep: row.nextStep,
  hasAudio: row.hasAudio,
  favoriteAt: row.favoriteAt?.toISOString() ?? null,
  projectPath: row.projectPath,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  ...(snippet ? { snippet } : {}),
});

const encodeCursor = (row: IdeaRow) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime()) || !z.uuid().safeParse(id).success) return null;
  return { createdAt, id };
}

const HEADLINE_OPTIONS = `StartSel=${SNIPPET_MARK_START}, StopSel=${SNIPPET_MARK_END}, MaxWords=24, MinWords=10, MaxFragments=1`;

/** "tele bot" -> "tele:* & bot:*" (prefix match). Only letters/digits survive, so it's always valid syntax. */
function toPrefixTsQuery(q: string): string | null {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return terms.length ? terms.map((t) => `${t}:*`).join(" & ") : null;
}

export async function listIdeas(userId: string, query: ListQuery): Promise<IdeasResponse> {
  const where: SQL[] = [eq(ideas.userId, userId)];

  if (query.view === "archive") where.push(isNotNull(ideas.archivedAt));
  else where.push(isNull(ideas.archivedAt));
  if (query.view === "inbox") where.push(eq(ideas.status, "inbox"));
  if (query.view === "filed") where.push(eq(ideas.status, "filed"));
  if (query.folderId) where.push(eq(ideas.folderId, query.folderId));

  // Search: full-text with prefix matching, plus a substring fallback for partial words.
  if (query.q) {
    const tsq = toPrefixTsQuery(query.q);
    const like = `%${escapeLike(query.q)}%`;
    const matchers: SQL[] = [ilike(ideas.title, like), ilike(ideas.body, like)];
    if (tsq) matchers.push(sql`${ideas.search} @@ to_tsquery('simple', ${tsq})`);
    where.push(or(...matchers)!);

    const rows = await db
      .select({
        idea: ideas,
        snippet: tsq
          ? sql<string>`ts_headline('simple', ${ideas.body}, to_tsquery('simple', ${tsq}), ${HEADLINE_OPTIONS})`
          : sql<null>`null`,
      })
      .from(ideas)
      .where(and(...where))
      .orderBy(
        tsq ? sql`ts_rank(${ideas.search}, to_tsquery('simple', ${tsq})) desc` : desc(ideas.createdAt),
        desc(ideas.createdAt),
      )
      .limit(query.limit);
    return { ideas: rows.map((r) => toIdea(r.idea, r.snippet)), nextCursor: null };
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) where.push(sql`(${ideas.createdAt}, ${ideas.id}) < (${cursor.createdAt}, ${cursor.id})`);

  const rows = await db
    .select()
    .from(ideas)
    .where(and(...where))
    .orderBy(desc(ideas.createdAt), desc(ideas.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    ideas: page.map((row) => toIdea(row)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

async function getOwnedIdea(userId: string, ideaId: string): Promise<IdeaRow> {
  const [row] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)));
  if (!row) throw notFound("Idea");
  return row;
}

export const getIdea = async (userId: string, ideaId: string) => toIdea(await getOwnedIdea(userId, ideaId));

async function buildSuggestInput(userId: string, text: string): Promise<SuggestInput> {
  const [folderRows, exampleRows, [owner]] = await Promise.all([
    db
      .select({ id: folders.id, name: folders.name, icon: folders.icon })
      .from(folders)
      .where(eq(folders.userId, userId)),
    db
      .select({ title: ideas.title, folderName: folders.name })
      .from(ideas)
      .innerJoin(folders, eq(folders.id, ideas.folderId))
      .where(and(eq(ideas.userId, userId), eq(ideas.status, "filed"), isNull(ideas.archivedAt)))
      .orderBy(desc(ideas.updatedAt))
      .limit(25),
    db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)),
  ]);
  return { text, folders: folderRows, examples: exampleRows, locale: owner?.locale ?? "en" };
}

/**
 * Saves the idea to the inbox right away, with a title, folder suggestion and first step attached.
 * A voice recording (from /voice/transcribe) can be attached in the same transaction.
 */
export async function createIdea(
  userId: string,
  input: { text: string; clipId?: string },
  log: FastifyBaseLogger,
): Promise<Idea> {
  const suggestion = await suggestFolder(await buildSuggestInput(userId, input.text), log);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ideas)
      .values({
        userId,
        title: suggestion.title,
        body: input.text,
        status: "inbox",
        suggestion,
      })
      .returning();
    // The suggested first step starts the idea's checklist.
    if (suggestion.firstStep) await addFirstStep(tx, userId, inserted!.id, suggestion.firstStep);
    if (input.clipId) await attachClip(tx, userId, input.clipId, inserted!.id);
    const [fresh] = await tx.select().from(ideas).where(eq(ideas.id, inserted!.id));
    return fresh!;
  });
  return toIdea(row);
}

export async function resuggest(userId: string, ideaId: string, log: FastifyBaseLogger): Promise<Idea> {
  const idea = await getOwnedIdea(userId, ideaId);
  const suggestion = await suggestFolder(await buildSuggestInput(userId, idea.body), log);
  const row = await db.transaction(async (tx) => {
    await tx.update(ideas).set({ suggestion }).where(eq(ideas.id, idea.id));
    // Refresh the suggested first step too, unless the user has already made the checklist their own.
    if (suggestion.firstStep) {
      const steps = await tx.select().from(ideaSteps).where(eq(ideaSteps.ideaId, idea.id));
      const only = steps.length === 1 ? steps[0]! : null;
      if (steps.length === 0) {
        await addFirstStep(tx, userId, idea.id, suggestion.firstStep);
      } else if (only && !only.doneAt && only.text === idea.suggestion?.firstStep) {
        await tx.update(ideaSteps).set({ text: suggestion.firstStep }).where(eq(ideaSteps.id, only.id));
        await syncNextStep(tx, idea.id);
      }
    }
    const [fresh] = await tx.select().from(ideas).where(eq(ideas.id, idea.id));
    return fresh!;
  });
  return toIdea(row);
}

/**
 * Ideas related to some text: what the bar shows while you type, so you pick up an
 * existing idea instead of writing it again. Short queries behave like search
 * (every word must prefix-match); longer text needs at least two shared words.
 */
export async function relatedIdeas(
  userId: string,
  q: string,
  opts: { exclude?: string; limit: number },
): Promise<RelatedIdea[]> {
  const significant = [...new Set(tokenize(q))];
  const words = significant.length ? significant : [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const terms = words.slice(0, 12);
  if (terms.length === 0) return [];

  const anyTerm = terms.map((t) => `${t}:*`).join(" | ");
  const hits = sql<number>`(${sql.join(
    terms.map((t) => sql`(${ideas.search} @@ to_tsquery('simple', ${`${t}:*`}))::int`),
    sql` + `,
  )})`.mapWith(Number);
  const needed = terms.length <= 2 ? terms.length : 2;
  const similarity = sql<number>`similarity(lower(${ideas.title} || ' ' || ${ideas.body}), lower(${q}))`.mapWith(Number);

  const rows = await db
    .select({
      idea: ideas,
      hits,
      similarity,
      snippet: sql<string>`ts_headline('simple', ${ideas.body}, to_tsquery('simple', ${anyTerm}), ${HEADLINE_OPTIONS})`,
    })
    .from(ideas)
    .where(
      and(
        eq(ideas.userId, userId),
        isNull(ideas.archivedAt),
        opts.exclude ? ne(ideas.id, opts.exclude) : undefined,
        sql`${ideas.search} @@ to_tsquery('simple', ${anyTerm})`,
        sql`${hits} >= ${needed}`,
      ),
    )
    .orderBy(desc(hits), sql`ts_rank(${ideas.search}, to_tsquery('simple', ${anyTerm})) desc`, desc(ideas.updatedAt))
    .limit(opts.limit);

  // Only whole sentences can be duplicates; a two-word search isn't a re-typed idea.
  const longEnough = q.length >= 24;
  return rows.map((r) => ({ ...toIdea(r.idea, r.snippet), duplicate: longEnough && r.similarity >= 0.45 }));
}

/** Filed ideas with a next step, least recently touched first: the ones at risk of being forgotten. */
export async function pickUpIdeas(userId: string): Promise<Idea[]> {
  const rows = await db
    .select()
    .from(ideas)
    .where(
      and(eq(ideas.userId, userId), eq(ideas.status, "filed"), isNull(ideas.archivedAt), isNotNull(ideas.nextStep)),
    )
    .orderBy(asc(ideas.updatedAt))
    .limit(5);
  return rows.map((row) => toIdea(row));
}

export async function confirmIdea(
  userId: string,
  ideaId: string,
  body: ConfirmIdeaBody,
): Promise<ConfirmIdeaResponse> {
  const { row, folderId } = await db.transaction(async (tx) => {
    const idea = await getOwnedIdea(userId, ideaId);
    const folder =
      body.target.kind === "existing"
        ? await getFolder(userId, body.target.folderId, tx)
        : await findOrCreateFolder(tx, userId, body.target.name, body.target.icon);
    const [updated] = await tx
      .update(ideas)
      .set({ folderId: folder.id, status: "filed", ...(body.title && { title: body.title }) })
      .where(eq(ideas.id, idea.id))
      .returning();
    return { row: updated!, folderId: folder.id };
  });
  return { idea: toIdea(row), folder: await getFolder(userId, folderId) };
}

export async function updateIdea(userId: string, ideaId: string, body: UpdateIdeaBody): Promise<Idea> {
  await getOwnedIdea(userId, ideaId);
  const patch: Partial<IdeaRow> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.body !== undefined) patch.body = body.body;
  if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date() : null;
  if (body.projectPath !== undefined) patch.projectPath = body.projectPath;
  if (body.folderId !== undefined) {
    if (body.folderId === null) {
      patch.folderId = null;
      patch.status = "inbox";
    } else {
      await getFolder(userId, body.folderId); // ownership check
      patch.folderId = body.folderId;
      patch.status = "filed";
    }
  }
  if (Object.keys(patch).length === 0) return getIdea(userId, ideaId);
  const [row] = await db.update(ideas).set(patch).where(eq(ideas.id, ideaId)).returning();
  return toIdea(row!);
}

export async function deleteIdea(userId: string, ideaId: string) {
  // Rows cascade with the idea; the stored bytes have to be removed separately.
  const storageKeys = await storageKeysForIdea(userId, ideaId);
  const [row] = await db
    .delete(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)))
    .returning({ id: ideas.id });
  if (!row) throw notFound("Idea");
  await removeFiles(storageKeys);
}

/** Stars or unstars an idea as a favourite project. Favourites lead the projects board. */
export async function setFavorite(userId: string, ideaId: string, favorite: boolean): Promise<Idea> {
  const [row] = await db
    .update(ideas)
    .set({ favoriteAt: favorite ? sql`coalesce(${ideas.favoriteAt}, now())` : null })
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)))
    .returning();
  if (!row) throw notFound("Idea");
  return toIdea(row);
}
