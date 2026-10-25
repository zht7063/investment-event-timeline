import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDb } from "@/server/db";
import { resetToSeed } from "@/server/seed";

it("upgrades existing databases without losing data and can reopen them", () => {
  const directory = mkdtempSync(join(tmpdir(), "evt-migration-"));
  const path = join(directory, "legacy.db");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(readFileSync("src/server/schema.sql", "utf8").replace("  subject_hint TEXT,\n", ""));
    resetToSeed(legacy);
    const before = legacy.prepare("select count(*) n from claims").get();
    legacy.close();
    for (let i = 0; i < 2; i++) {
      const db = openDb(path);
      try {
        expect(db.prepare("PRAGMA table_info(document_versions)").all().some((column) => column.name === "subject_hint")).toBe(true);
        expect(db.prepare("select count(*) n from claims").get()).toEqual(before);
        expect(db.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
