import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let db: DatabaseSync | undefined;

// process.cwd() keeps the path stable under both Next.js bundling and Vitest.
const schemaPath = () => join(process.cwd(), "src/server/schema.sql");

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec(readFileSync(schemaPath(), "utf8"));
  return d;
}

export function getDb(): DatabaseSync {
  db ??= openDb(process.env.DATABASE_PATH || "./data/app.db");
  return db;
}

/** For tests: swap in an isolated database. */
export function setDb(d: DatabaseSync | undefined) {
  db = d;
}

export function tx<T>(d: DatabaseSync, fn: () => T): T {
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
