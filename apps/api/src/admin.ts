import { readFile } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { EmailSchema, FolderIconSchema, FolderNameSchema, LIMITS, LocaleSchema } from "@lightbulb/shared";
import { db, sqlClient } from "./db/client.js";
import { ideaNotes, ideaSteps, ideas, sessions, users } from "./db/schema.js";
import { findOrCreateFolder } from "./folders/service.js";
import { syncNextStep } from "./notebook/service.js";
import { generatePassword, hashPassword } from "./auth/password.js";

// Account admin, for servers where sign-up is closed (ALLOW_SIGNUP=false).
//   set-password <email> [en|ru]   create the account if needed, set a new generated password,
//                                  sign it out everywhere, and print the password once
//   list-users                     emails, languages and whether a password is set
//   add-project <email> <file.json> bring in an existing project: a filed idea with its steps,
//                                  notes, folder on the user's computer, starred as a favourite
// Locally: npm run admin -w @lightbulb/api -- list-users
// Server:  node --env-file=/opt/lightbulb/lightbulb.env dist/admin.js list-users

const [command, ...args] = process.argv.slice(2);

async function setPassword(emailArg: string | undefined, localeArg: string | undefined) {
  const email = EmailSchema.parse(emailArg);
  const locale = localeArg ? LocaleSchema.parse(localeArg) : undefined;
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, ...(locale && { locale }) })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, ...(locale && { locale }) } })
    .returning({ id: users.id, email: users.email, locale: users.locale });
  // A new password signs the account out of every browser that had the old one.
  await db.delete(sessions).where(eq(sessions.userId, user!.id));
  console.log(`Account: ${user!.email} (${user!.locale})`);
  console.log(`Password: ${password}`);
  console.log("Shown once. Run set-password again to replace it.");
}

const ProjectFile = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(LIMITS.bodyChars),
  folder: z.object({ name: FolderNameSchema, icon: FolderIconSchema.default("Folder") }),
  steps: z.array(z.string().trim().min(1).max(LIMITS.stepChars)).max(LIMITS.steps).default([]),
  notes: z.array(z.string().trim().min(1).max(LIMITS.noteChars)).max(20).default([]),
  projectPath: z.string().trim().min(2).max(400).nullable().default(null),
  favorite: z.boolean().default(true),
});

async function addProject(emailArg: string | undefined, file: string | undefined) {
  const email = EmailSchema.parse(emailArg);
  if (!file) throw new Error("Give the project's JSON file");
  const project = ProjectFile.parse(JSON.parse(await readFile(file, "utf8")));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No account for ${email}`);

  const ideaId = await db.transaction(async (tx) => {
    const folder = await findOrCreateFolder(tx, user.id, project.folder.name, project.folder.icon);
    const [idea] = await tx
      .insert(ideas)
      .values({
        userId: user.id,
        folderId: folder.id,
        title: project.title,
        body: project.body,
        status: "filed",
        projectPath: project.projectPath,
        favoriteAt: project.favorite ? new Date() : null,
      })
      .returning({ id: ideas.id });
    if (project.steps.length) {
      await tx.insert(ideaSteps).values(project.steps.map((text, position) => ({ ideaId: idea!.id, userId: user.id, text, position })));
    }
    // Oldest first, so the newest note is the last one listed in the file.
    for (const text of project.notes) await tx.insert(ideaNotes).values({ ideaId: idea!.id, userId: user.id, text });
    await syncNextStep(tx, idea!.id);
    return idea!.id;
  });
  console.log(`Added "${project.title}" for ${email}: ${ideaId}`);
}

async function listUsers() {
  const rows = await db
    .select({ email: users.email, locale: users.locale, passwordHash: users.passwordHash, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
  for (const row of rows) {
    console.log(`${row.email}  ${row.locale}  ${row.passwordHash ? "password" : "link only"}  ${row.createdAt.toISOString().slice(0, 10)}`);
  }
  if (!rows.length) console.log("No accounts yet.");
}

try {
  if (command === "set-password") await setPassword(args[0], args[1]);
  else if (command === "list-users") await listUsers();
  else if (command === "add-project") await addProject(args[0], args[1]);
  else {
    console.log("Usage: admin set-password <email> [en|ru] | admin list-users | admin add-project <email> <file.json>");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sqlClient.end();
}
