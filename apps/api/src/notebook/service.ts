import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, asc, count, desc, eq, isNull, max, sql, sum } from "drizzle-orm";
import {
  LIMITS,
  type AddNoteBody,
  type IdeaFile,
  type IdeaNote,
  type IdeaNotebook,
  type IdeaStep,
  type UpdateStepBody,
} from "@lightbulb/shared";
import { db, type Db, type Tx } from "../db/client.js";
import { audioClips, ideaFiles, ideaNotes, ideaSteps, ideas } from "../db/schema.js";
import { HttpError, notFound } from "../lib/http.js";
import { putFile, removeFiles } from "../storage/files.js";

type Conn = Db | Tx;

const full = (what: string, limit: number) =>
  new HttpError(409, "limit_reached", `This idea already has ${limit} ${what}. Finish or remove some first.`);

async function requireIdea(conn: Conn, userId: string, ideaId: string) {
  const [idea] = await conn
    .select({ id: ideas.id })
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.userId, userId)));
  if (!idea) throw notFound("Idea");
}

/**
 * Keeps ideas.next_step equal to the first unchecked step. Also bumps updated_at,
 * which is what "Pick one up" uses to find ideas nobody has touched in a while.
 */
export async function syncNextStep(conn: Conn, ideaId: string) {
  const [first] = await conn
    .select({ text: ideaSteps.text })
    .from(ideaSteps)
    .where(and(eq(ideaSteps.ideaId, ideaId), isNull(ideaSteps.doneAt)))
    .orderBy(asc(ideaSteps.position), asc(ideaSteps.createdAt))
    .limit(1);
  await conn.update(ideas).set({ nextStep: first?.text ?? null }).where(eq(ideas.id, ideaId));
}

// ---------- Read ----------

const toStep = (row: typeof ideaSteps.$inferSelect): IdeaStep => ({
  id: row.id,
  text: row.text,
  done: row.doneAt !== null,
  doneAt: row.doneAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const toFile = (row: typeof ideaFiles.$inferSelect): IdeaFile => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  mime: row.mime,
  sizeBytes: row.sizeBytes,
  url: `/api/files/${row.id}`,
  createdAt: row.createdAt.toISOString(),
});

export async function getNotebook(userId: string, ideaId: string): Promise<IdeaNotebook> {
  await requireIdea(db, userId, ideaId);
  const [steps, notes, files] = await Promise.all([
    db
      .select()
      .from(ideaSteps)
      .where(eq(ideaSteps.ideaId, ideaId))
      .orderBy(asc(ideaSteps.position), asc(ideaSteps.createdAt)),
    db
      .select({
        id: ideaNotes.id,
        text: ideaNotes.text,
        createdAt: ideaNotes.createdAt,
        hasAudio: sql<boolean>`exists (select 1 from ${audioClips} where ${audioClips.noteId} = ${ideaNotes.id})`,
      })
      .from(ideaNotes)
      .where(eq(ideaNotes.ideaId, ideaId))
      .orderBy(desc(ideaNotes.createdAt)),
    db.select().from(ideaFiles).where(eq(ideaFiles.ideaId, ideaId)).orderBy(desc(ideaFiles.createdAt)),
  ]);
  return {
    steps: steps.map(toStep),
    notes: notes.map(
      (n): IdeaNote => ({ id: n.id, text: n.text, hasAudio: n.hasAudio, createdAt: n.createdAt.toISOString() }),
    ),
    files: files.map(toFile),
  };
}

// ---------- Steps ----------

export async function addStep(userId: string, ideaId: string, text: string): Promise<IdeaStep> {
  return db.transaction(async (tx) => {
    await requireIdea(tx, userId, ideaId);
    const [stats] = await tx
      .select({ total: count(), last: max(ideaSteps.position) })
      .from(ideaSteps)
      .where(eq(ideaSteps.ideaId, ideaId));
    if ((stats?.total ?? 0) >= LIMITS.steps) throw full("steps", LIMITS.steps);
    const [row] = await tx
      .insert(ideaSteps)
      .values({ ideaId, userId, text, position: (stats?.last ?? -1) + 1 })
      .returning();
    await syncNextStep(tx, ideaId);
    return toStep(row!);
  });
}

/** Adds the suggested first step to an idea that has no steps yet. */
export async function addFirstStep(conn: Conn, userId: string, ideaId: string, text: string) {
  const [existing] = await conn.select({ id: ideaSteps.id }).from(ideaSteps).where(eq(ideaSteps.ideaId, ideaId)).limit(1);
  if (existing) return;
  await conn.insert(ideaSteps).values({ ideaId, userId, text: text.slice(0, LIMITS.stepChars), position: 0 });
  await syncNextStep(conn, ideaId);
}

export async function updateStep(userId: string, stepId: string, body: UpdateStepBody): Promise<IdeaStep> {
  return db.transaction(async (tx) => {
    const patch: Partial<typeof ideaSteps.$inferInsert> = {};
    if (body.text !== undefined) patch.text = body.text;
    if (body.done !== undefined) patch.doneAt = body.done ? new Date() : null;
    const [row] = await tx
      .update(ideaSteps)
      .set(patch)
      .where(and(eq(ideaSteps.id, stepId), eq(ideaSteps.userId, userId)))
      .returning();
    if (!row) throw notFound("Step");
    await syncNextStep(tx, row.ideaId);
    return toStep(row);
  });
}

/** Moves an unchecked step to the top, making it the next step. */
export async function makeStepNext(userId: string, stepId: string): Promise<IdeaStep> {
  return db.transaction(async (tx) => {
    const [step] = await tx
      .select()
      .from(ideaSteps)
      .where(and(eq(ideaSteps.id, stepId), eq(ideaSteps.userId, userId)));
    if (!step) throw notFound("Step");
    const [first] = await tx
      .select({ position: sql<number>`min(${ideaSteps.position})` })
      .from(ideaSteps)
      .where(eq(ideaSteps.ideaId, step.ideaId));
    const [row] = await tx
      .update(ideaSteps)
      .set({ position: (first?.position ?? 0) - 1, doneAt: null })
      .where(eq(ideaSteps.id, step.id))
      .returning();
    await syncNextStep(tx, step.ideaId);
    return toStep(row!);
  });
}

export async function deleteStep(userId: string, stepId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(ideaSteps)
      .where(and(eq(ideaSteps.id, stepId), eq(ideaSteps.userId, userId)))
      .returning({ ideaId: ideaSteps.ideaId });
    if (!row) throw notFound("Step");
    await syncNextStep(tx, row.ideaId);
  });
}

// ---------- Notes ----------

export async function addNote(userId: string, ideaId: string, body: AddNoteBody): Promise<IdeaNote> {
  return db.transaction(async (tx) => {
    await requireIdea(tx, userId, ideaId);
    const [stats] = await tx.select({ total: count() }).from(ideaNotes).where(eq(ideaNotes.ideaId, ideaId));
    if ((stats?.total ?? 0) >= LIMITS.notes) throw full("notes", LIMITS.notes);
    const [note] = await tx.insert(ideaNotes).values({ ideaId, userId, text: body.text }).returning();
    let hasAudio = false;
    if (body.clipId) {
      const [clip] = await tx
        .update(audioClips)
        .set({ noteId: note!.id })
        .where(
          and(
            eq(audioClips.id, body.clipId),
            eq(audioClips.userId, userId),
            isNull(audioClips.ideaId),
            isNull(audioClips.noteId),
          ),
        )
        .returning({ id: audioClips.id });
      if (!clip) throw new HttpError(400, "invalid_clip", "That recording is no longer available");
      hasAudio = true;
    }
    await syncNextStep(tx, ideaId); // touches the idea
    return { id: note!.id, text: note!.text, hasAudio, createdAt: note!.createdAt.toISOString() };
  });
}

export async function deleteNote(userId: string, noteId: string) {
  const [row] = await db
    .delete(ideaNotes)
    .where(and(eq(ideaNotes.id, noteId), eq(ideaNotes.userId, userId)))
    .returning({ id: ideaNotes.id });
  if (!row) throw notFound("Note");
}

export async function getNoteAudio(userId: string, noteId: string) {
  const [clip] = await db
    .select({ mime: audioClips.mime, data: audioClips.data })
    .from(audioClips)
    .where(and(eq(audioClips.noteId, noteId), eq(audioClips.userId, userId)))
    .limit(1);
  if (!clip) throw notFound("Recording");
  return clip;
}

// ---------- Files ----------

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const FILE_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/heic",
  "image/heif",
]);
// Browsers often send an empty or generic type for these; fall back to the extension.
const BY_EXTENSION: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".heic": "image/heic",
};

/** Normalises the declared type, or returns null for anything we don't accept (e.g. SVG, HTML). */
export function classifyUpload(declared: string | undefined, filename: string) {
  let mime = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime || mime === "application/octet-stream" || mime === "application/x-zip-compressed") {
    mime = BY_EXTENSION[path.extname(filename).toLowerCase()] ?? mime;
  }
  if (IMAGE_TYPES.has(mime)) return { kind: "image" as const, mime };
  if (FILE_TYPES.has(mime)) return { kind: "file" as const, mime };
  return null;
}

/** Keeps a readable name without path parts or control characters. */
export const cleanFileName = (name: string) =>
  (path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").trim() || "file").slice(0, 200);

export async function addFile(
  userId: string,
  ideaId: string,
  upload: { name: string; mime: string | undefined; data: Buffer },
): Promise<IdeaFile> {
  const type = classifyUpload(upload.mime, upload.name);
  if (!type) throw new HttpError(415, "unsupported_file", "That file type isn't supported");
  await requireIdea(db, userId, ideaId);

  const [[perIdea], [perUser]] = await Promise.all([
    db.select({ total: count() }).from(ideaFiles).where(eq(ideaFiles.ideaId, ideaId)),
    db.select({ bytes: sum(ideaFiles.sizeBytes) }).from(ideaFiles).where(eq(ideaFiles.userId, userId)),
  ]);
  if ((perIdea?.total ?? 0) >= LIMITS.files) throw full("files", LIMITS.files);
  if (Number(perUser?.bytes ?? 0) + upload.data.length > LIMITS.userStorageBytes) {
    throw new HttpError(413, "storage_full", "Your storage is full. Delete some files first.");
  }

  const storageKey = `${userId}/${randomUUID()}`;
  await putFile(storageKey, upload.data);
  try {
    const [row] = await db
      .insert(ideaFiles)
      .values({
        ideaId,
        userId,
        kind: type.kind,
        name: cleanFileName(upload.name),
        mime: type.mime,
        sizeBytes: upload.data.length,
        storageKey,
      })
      .returning();
    await syncNextStep(db, ideaId); // touches the idea
    return toFile(row!);
  } catch (err) {
    await removeFiles([storageKey]);
    throw err;
  }
}

export async function getFile(userId: string, fileId: string) {
  const [row] = await db
    .select()
    .from(ideaFiles)
    .where(and(eq(ideaFiles.id, fileId), eq(ideaFiles.userId, userId)));
  if (!row) throw notFound("File");
  return row;
}

export async function deleteFile(userId: string, fileId: string) {
  const [row] = await db
    .delete(ideaFiles)
    .where(and(eq(ideaFiles.id, fileId), eq(ideaFiles.userId, userId)))
    .returning({ storageKey: ideaFiles.storageKey });
  if (!row) throw notFound("File");
  await removeFiles([row.storageKey]);
}

/** Storage keys for an idea's files, to remove from disk when the idea is deleted. */
export async function storageKeysForIdea(userId: string, ideaId: string) {
  const rows = await db
    .select({ key: ideaFiles.storageKey })
    .from(ideaFiles)
    .where(and(eq(ideaFiles.ideaId, ideaId), eq(ideaFiles.userId, userId)));
  return rows.map((r) => r.key);
}
