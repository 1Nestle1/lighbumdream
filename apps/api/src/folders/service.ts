import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type {
  BankCounts,
  CreateFolderBody,
  Folder,
  FolderIcon,
  UpdateFolderBody,
} from "@lightbulb/shared";
import { db, type Db, type Tx } from "../db/client.js";
import { folders, ideas, type FolderRow } from "../db/schema.js";
import { HttpError, notFound } from "../lib/http.js";
import { isUniqueViolation } from "../lib/pg.js";


const ideaCount = sql<number>`count(${ideas.id}) filter (where ${ideas.archivedAt} is null)`.mapWith(
  Number,
);

export const toFolder = (row: FolderRow, count: number): Folder => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  ideaCount: count,
  createdAt: row.createdAt.toISOString(),
});

export async function listFolders(userId: string): Promise<Folder[]> {
  const rows = await db
    .select({ ...getTableColumns(folders), ideaCount })
    .from(folders)
    .leftJoin(ideas, eq(ideas.folderId, folders.id))
    .where(eq(folders.userId, userId))
    .groupBy(folders.id)
    .orderBy(asc(sql`lower(${folders.name})`));
  return rows.map(({ ideaCount: count, ...row }) => toFolder(row, count));
}

export async function getBankCounts(userId: string): Promise<BankCounts> {
  const [row] = await db
    .select({
      all: sql<number>`count(*) filter (where ${ideas.archivedAt} is null)`.mapWith(Number),
      inbox: sql<number>`count(*) filter (where ${ideas.archivedAt} is null and ${ideas.status} = 'inbox')`.mapWith(
        Number,
      ),
      archived: sql<number>`count(*) filter (where ${ideas.archivedAt} is not null)`.mapWith(Number),
      thisWeek: sql<number>`count(*) filter (where ${ideas.archivedAt} is null and ${ideas.createdAt} > now() - interval '7 days')`.mapWith(
        Number,
      ),
    })
    .from(ideas)
    .where(eq(ideas.userId, userId));
  return row ?? { all: 0, inbox: 0, archived: 0, thisWeek: 0 };
}

export async function getFolder(userId: string, folderId: string, tx: Db | Tx = db): Promise<Folder> {
  const [row] = await tx
    .select({ ...getTableColumns(folders), ideaCount })
    .from(folders)
    .leftJoin(ideas, eq(ideas.folderId, folders.id))
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
    .groupBy(folders.id);
  if (!row) throw notFound("Folder");
  const { ideaCount: count, ...folder } = row;
  return toFolder(folder, count);
}

const duplicateName = () =>
  new HttpError(409, "folder_exists", "You already have a folder with this name");

export async function createFolder(userId: string, body: CreateFolderBody & { icon: FolderIcon }) {
  try {
    const [row] = await db
      .insert(folders)
      .values({ userId, name: body.name, icon: body.icon })
      .returning();
    return toFolder(row!, 0);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName();
    throw err;
  }
}

/** Used when confirming a suggested new folder: reuse a same-named folder if one exists. */
export async function findOrCreateFolder(tx: Tx, userId: string, name: string, icon: FolderIcon) {
  const [inserted] = await tx
    .insert(folders)
    .values({ userId, name, icon, autoCreated: true })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [existing] = await tx
    .select()
    .from(folders)
    .where(and(eq(folders.userId, userId), eq(sql`lower(${folders.name})`, name.toLowerCase())));
  if (!existing) throw new Error("Folder conflict without an existing row");
  return existing;
}

export async function updateFolder(userId: string, folderId: string, body: UpdateFolderBody) {
  try {
    const [row] = await db
      .update(folders)
      .set(body)
      .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
      .returning({ id: folders.id });
    if (!row) throw notFound("Folder");
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateName();
    throw err;
  }
  return getFolder(userId, folderId);
}

/** Deleting a folder never deletes ideas: they go back to the inbox. */
export async function deleteFolder(userId: string, folderId: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(folders)
      .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
      .returning({ id: folders.id });
    if (!row) throw notFound("Folder");
    // The FK already nulls folder_id; flip the status so they show up for re-filing.
    await tx
      .update(ideas)
      .set({ status: "inbox" })
      .where(and(eq(ideas.userId, userId), isNull(ideas.folderId), eq(ideas.status, "filed")));
  });
}
