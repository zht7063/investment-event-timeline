/**
 * Cron entry: sync every configured provider once.
 * Run with `npm run sync` (uses --env-file-if-exists=.env). Exit 0 ok, 1 errors, 2 another run holds the lock.
 */
import { ensureSeeded } from "../src/server/seed";
import { configuredProviderIds, lockedSync, registerProviders } from "../src/server/sources/sync";

const db = ensureSeeded();
registerProviders(db);
const ids = configuredProviderIds();
console.log(`[sync] ${new Date().toISOString()} start: ${ids.join(", ") || "no configured providers"}`);
const results = await lockedSync(ids, db);
let code = 0;
for (const r of results) {
  console.log(`[sync] ${r.sourceId} ${r.status}: +${r.added} new, ${r.duplicates} duplicate, ${r.analyzed} analyzed`);
  for (const e of r.errors) console.error(`[sync] ${r.sourceId} error: ${e}`);
  if (r.status === "busy") code = 2;
  else if (r.errors.length && code === 0) code = 1;
}
process.exit(code);
