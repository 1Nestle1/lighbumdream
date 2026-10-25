import { asc, eq } from "drizzle-orm";
import { EmailSchema, LocaleSchema } from "@lightbulb/shared";
import { db, sqlClient } from "./db/client.js";
import { sessions, users } from "./db/schema.js";
import { generatePassword, hashPassword } from "./auth/password.js";

// Account admin, for servers where sign-up is closed (ALLOW_SIGNUP=false).
//   set-password <email> [en|ru]   create the account if needed, set a new generated password,
//                                  sign it out everywhere, and print the password once
//   list-users                     emails, languages and whether a password is set
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
  else {
    console.log("Usage: admin set-password <email> [en|ru] | admin list-users");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sqlClient.end();
}
