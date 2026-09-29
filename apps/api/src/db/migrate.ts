import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "./client.js";

// Works from src/db (tsx) and dist (bundled): both sit two levels below apps/api.
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, here.endsWith("dist") ? ".." : "../..", "drizzle");

await migrate(db, { migrationsFolder });
console.log("Migrations applied");
await sqlClient.end();
