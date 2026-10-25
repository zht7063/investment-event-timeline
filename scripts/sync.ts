#!/usr/bin/env -S npx tsx
/**
 * Cron-callable sync script. Acquires a file lock so two runs cannot overlap.
 * Usage: npx tsx scripts/sync.ts
 * Exit codes: 0 = success, 1 = errors, 2 = already running
 */
import "dotenv/config";
import { acquireLock, syncAll } from "../src/server/sources/sync";

async function main() {
  const release = acquireLock();
  if (!release) {
    console.error("[sync] another sync is already running, exiting");
    process.exit(2);
  }
  try {
    console.log(`[sync] started at ${new Date().toISOString()}`);
    const results = await syncAll();
    let hasError = false;
    for (const r of results) {
      console.log(`[sync] ${r.sourceId}: +${r.added} new, ${r.duplicates} dup, ${r.analyzed} analyzed`);
      if (r.errors.length) {
        hasError = true;
        for (const e of r.errors) console.error(`[sync] ${r.sourceId} error: ${e}`);
      }
    }
    if (results.length === 0) console.log("[sync] no configured sources");
    console.log(`[sync] finished at ${new Date().toISOString()}`);
    process.exit(hasError ? 1 : 0);
  } finally {
    release();
  }
}

main().catch((e) => {
  console.error("[sync] fatal:", e);
  process.exit(1);
});
