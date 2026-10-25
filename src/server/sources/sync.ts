/**
 * Shared sync logic for data source connectors.
 * Both cron script and the manual sync API call into this module.
 * Each run writes a sync_runs record; dedup is handled by importDocument.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openSync, closeSync, unlinkSync } from "node:fs";
import { parseTime } from "@/domain/time";
import { importDocument, analyzeVersion, type ImportInput } from "../ingest";
import { getDb, tx } from "../db";
import { latestVersion } from "../versions";
import * as fuyao from "./fuyao";
import * as ifind from "./ifind";

const LOCK_PATH = "/tmp/evt-timeline-sync.lock";

/** Acquire an exclusive file lock. Returns a release function, or null if already locked. */
export function acquireLock(): (() => void) | null {
  try {
    const fd = openSync(LOCK_PATH, "wx");
    return () => {
      try { closeSync(fd); } catch {}
      try { unlinkSync(LOCK_PATH); } catch {}
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw e;
  }
}

export type SyncResult = {
  sourceId: string;
  added: number;
  duplicates: number;
  analyzed: number;
  errors: string[];
};

function startRun(sourceId: string, now: string, db: DatabaseSync): string {
  const id = randomUUID();
  db.prepare("insert into sync_runs (id, source_id, started_at, status) values (?, ?, ?, 'running')").run(id, sourceId, now);
  return id;
}

function finishRun(runId: string, result: SyncResult, db: DatabaseSync) {
  const now = new Date().toISOString();
  const ok = result.errors.length === 0;
  db.prepare("update sync_runs set finished_at = ?, status = ?, added = ?, duplicates = ?, error = ? where id = ?").run(
    now, ok ? "ok" : "failed", result.added, result.duplicates, result.errors.join("; ").slice(0, 2000) || null, runId,
  );
  // Update source last_success / last_error
  if (ok) {
    db.prepare("update sources set last_success_at = ?, last_error = null where id = ?").run(now, result.sourceId);
  } else {
    db.prepare("update sources set last_error = ? where id = ?").run(result.errors[0]?.slice(0, 500) ?? "unknown", result.sourceId);
  }
}

/** Ensure the source row exists in the database. */
function ensureSource(id: string, name: string, kind: string, tier: number, accessMode: string, db: DatabaseSync) {
  const existing = db.prepare("select 1 from sources where id = ?").get(id);
  if (!existing) {
    db.prepare("insert into sources (id, name, kind, tier, access_mode) values (?, ?, ?, ?, ?)").run(id, name, kind, tier, accessMode);
  } else {
    db.prepare("update sources set access_mode = ? where id = ?").run(accessMode, id);
  }
}

/** Import a batch of items, counting added/duplicates. */
async function importBatch(
  items: ImportInput[],
  result: SyncResult,
  db: DatabaseSync,
) {
  for (const item of items) {
    try {
      const r = importDocument(item, db);
      if (r.decision === "duplicate") {
        result.duplicates++;
      } else {
        result.added++;
        // Auto-analyze new documents
        const v = latestVersion(r.documentId, db);
        if (v && v.analysis_status === "pending") {
          try {
            await analyzeVersion(v.id, undefined, db);
            result.analyzed++;
          } catch {
            // Analysis failure is non-fatal; document stays for manual review
          }
        }
      }
    } catch (e) {
      result.errors.push((e as Error).message);
    }
  }
}

/** Sync iFinD notices and news for all tracked subject codes. */
export async function syncIfind(db = getDb()): Promise<SyncResult> {
  const sourceId = "ifind-mcp";
  ensureSource(sourceId, "iFinD MCP", "media", 3, ifind.isConfigured() ? "live" : "unavailable", db);
  const result: SyncResult = { sourceId, added: 0, duplicates: 0, analyzed: 0, errors: [] };
  if (!ifind.isConfigured()) {
    result.errors.push("IFIND_TOKEN or IFIND_MCP_URL not configured");
    return result;
  }
  const now = new Date().toISOString();
  const runId = startRun(sourceId, now, db);

  // Get all tracked subject codes from events
  const codes = (db.prepare("select distinct subject_code from events").all() as { subject_code: string }[]).map((r) => r.subject_code);

  for (const code of codes) {
    try {
      const notices = await ifind.searchNotice(code, 30, 10);
      const items: ImportInput[] = notices
        .filter((n) => n.title && n.snippet)
        .map((n) => ({
          source: { id: sourceId },
          title: n.title,
          body: n.snippet,
          providerId: `ifind:notice:${n.title}`,
          publishedAt: n.date || null,
        }));
      await importBatch(items, result, db);
    } catch (e) {
      result.errors.push(`notice ${code}: ${(e as Error).message}`);
    }

    try {
      const news = await ifind.searchNews(code, 30, 10);
      const items: ImportInput[] = news
        .filter((n) => n.title && n.snippet)
        .map((n) => ({
          source: { id: sourceId },
          title: n.title,
          body: n.snippet,
          url: n.url,
          providerId: n.url ? undefined : `ifind:news:${n.title}`,
          publishedAt: n.date || null,
        }));
      await importBatch(items, result, db);
    } catch (e) {
      result.errors.push(`news ${code}: ${(e as Error).message}`);
    }
  }

  finishRun(runId, result, db);
  return result;
}

/** Sync Fuyao news for all tracked subject codes. */
export async function syncFuyao(db = getDb()): Promise<SyncResult> {
  const sourceId = "fuyao-rest";
  const hasBase = Boolean(process.env.FUYAO_API_KEY?.trim() && process.env.FUYAO_BASE_URL?.trim());
  ensureSource(sourceId, "Fuyao REST News", "media", 3, hasBase ? "live" : "unavailable", db);
  const result: SyncResult = { sourceId, added: 0, duplicates: 0, analyzed: 0, errors: [] };
  if (!hasBase) {
    result.errors.push("FUYAO_API_KEY or FUYAO_BASE_URL not configured");
    return result;
  }
  const now = new Date().toISOString();
  const runId = startRun(sourceId, now, db);

  // Get instrument codes that look like real A-share tickers (xxx.SZ / xxx.SH)
  const instruments = (db.prepare("select distinct code from event_instruments where code like '%.SZ' or code like '%.SH'").all() as { code: string }[]);

  for (const { code } of instruments) {
    try {
      const news = await fuyao.getNewsTimeline(code, 20);
      const items: ImportInput[] = news
        .filter((n) => n.title && n.content)
        .map((n) => ({
          source: { id: sourceId },
          title: n.title,
          body: n.content,
          url: n.url,
          providerId: n.url ? undefined : `fuyao:news:${n.title}`,
          publishedAt: n.date || null,
        }));
      await importBatch(items, result, db);
    } catch (e) {
      result.errors.push(`${code}: ${(e as Error).message}`);
    }
  }

  finishRun(runId, result, db);
  return result;
}

/** Run all configured syncs. */
export async function syncAll(db = getDb()): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  if (ifind.isConfigured()) results.push(await syncIfind(db));
  const hasFuyao = Boolean(process.env.FUYAO_API_KEY?.trim() && process.env.FUYAO_BASE_URL?.trim());
  if (hasFuyao) results.push(await syncFuyao(db));
  return results;
}
