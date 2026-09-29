import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

// A short connect timeout: when Postgres is down, requests fail fast with "db_unavailable".
export const sqlClient = postgres(env.DATABASE_URL, { max: 10, connect_timeout: 5 });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
