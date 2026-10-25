import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.env.DATABASE_PATH || "./data/app.db");
if (!existsSync(source)) {
  console.log("[backup] No database yet; nothing to back up.");
} else {
  const directory = resolve(process.env.BACKUP_DIR || "./backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `app-${new Date().toISOString().replaceAll(":", "-")}.db`);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
    chmodSync(target, 0o600);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      if (copy.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") {
        throw new Error("Backup integrity check failed");
      }
    } finally {
      copy.close();
    }
    console.log(`[backup] Verified: ${target}`);
  } finally {
    db.close();
  }
}
