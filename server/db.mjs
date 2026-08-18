/**
 * SQLite + Drizzle connection. The DB file lives at DATABASE_PATH (default
 * ./data/tagteam.db) so a single container persists state on a mounted volume.
 * Idempotent DDL runs at startup — no external migration toolchain required.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import * as schema from "./schema.mjs";

const DB_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "tagteam.db");

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/** Idempotent schema. Must stay in sync with server/schema.mjs. */
const DDL = `
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" integer NOT NULL DEFAULT 0,
  "image" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" integer NOT NULL,
  "token" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token");
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" integer,
  "refresh_token_expires_at" integer,
  "scope" text,
  "password" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_user_idx" ON "account" ("user_id");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "app_session" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'active',
  "pairing_token" text,
  "pairing_expires_at" integer,
  "created_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "app_session_user_idx" ON "app_session" ("user_id");

CREATE TABLE IF NOT EXISTS "scenario" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "session_id" text REFERENCES "app_session"("id"),
  "doc_summary" text,
  "summary" text,
  "reference" text,
  "target" text,
  "answers" text,
  "settings" text,
  "selection" text,
  "script" text,
  "glossary" text,
  "cheat_sheet" text,
  "created_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "scenario_user_idx" ON "scenario" ("user_id");
CREATE INDEX IF NOT EXISTS "scenario_session_idx" ON "scenario" ("session_id");
`;

sqlite.exec(DDL);

// Phase 5c — new columns on the scenario table for existing databases.
for (const column of [
  ["summary", "text"],
  ["reference", "text"],
  ["answers", "text"],
  ["settings", "text"],
  ["selection", "text"],
]) {
  try {
    sqlite.exec(`ALTER TABLE "scenario" ADD COLUMN ${column[0]} ${column[1]};`);
  } catch {
    /* column already exists — fine */
  }
}

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };
