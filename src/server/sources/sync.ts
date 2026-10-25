/**
 * Shared provider sync, used by scripts/sync.ts (cron) and POST /api/sources/:id/sync.
 * Every run writes sync_runs; importDocument dedup makes repeated syncs idempotent.
 * A lock file next to the database prevents overlapping runs.
 */
import { randomUUID } from "node:crypto";
import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { SourceKind } from "@/domain/types";
import { getDb } from "../db";
import { analyzeVersion, importDocument, type ImportInput } from "../ingest";
import * as fuyao from "./fuyao";
import * as ifind from "./ifind";

const LOCK_STALE_MS = 30 * 60_000;
/** Bound model cost per run; the rest stay "pending" and can be analyzed from the sources page. */
const MAX_ANALYZE_PER_RUN = 10;

const lockPath = () => `${process.env.DATABASE_PATH || "./data/app.db"}.sync.lock`;

/** Exclusive lock; a lock older than 30 minutes is treated as left over from a crashed run. */
export function acquireLock(path = lockPath()): (() => void) | null {
  try {
    if (Date.now() - statSync(/*turbopackIgnore: true*/ path).mtimeMs > LOCK_STALE_MS) unlinkSync(path);
  } catch {}
  try {
    const fd = openSync(/*turbopackIgnore: true*/ path, "wx");
    return () => {
      closeSync(fd);
      try {
        unlinkSync(path);
      } catch {}
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw e;
  }
}

type Provider = {
  id: string;
  name: string;
  kind: SourceKind;
  tier: number;
  configured: () => boolean;
  fetch: (code: string) => Promise<Omit<ImportInput, "source">[]>;
};

export const PROVIDERS: Provider[] = [
  {
    id: "ifind-notice",
    name: "iFinD 公告检索",
    kind: "issuer",
    tier: 2,
    configured: ifind.isConfigured,
    // Notices carry no URL; title is the provider identity. Snippets only, day precision.
    fetch: async (code) =>
      (await ifind.searchNotice(code, 30, 10))
        .filter((n) => n.title && n.snippet)
        .map((n) => ({ title: n.title, body: n.snippet, providerId: `ifind:notice:${n.title}`, publishedAt: n.date || null })),
  },
  {
    id: "ifind-news",
    name: "iFinD 新闻检索",
    kind: "media",
    tier: 3,
    configured: ifind.isConfigured,
    fetch: async (code) =>
      (await ifind.searchNews(code, 30, 10))
        .filter((n) => n.title && n.snippet)
        .map((n) => ({ title: n.title, body: n.snippet, url: n.url, providerId: n.url ? null : `ifind:news:${n.title}`, publishedAt: n.date || null })),
  },
  {
    id: "fuyao-news",
    name: "扶摇个股新闻",
    kind: "media",
    tier: 3,
    configured: () => Boolean(process.env.FUYAO_API_KEY?.trim() && process.env.FUYAO_BASE_URL?.trim()),
    fetch: async (code) =>
      (await fuyao.getNewsTimeline(code, 20))
        .filter((n) => n.title && n.content)
        .map((n) => ({ title: n.title, body: n.content.slice(0, 20_000), url: n.url, providerId: n.url ? null : `fuyao:news:${n.title}`, publishedAt: n.date || null })),
  },
];

/** Registers provider rows so the sources page shows "未接入" with the reason before any run. */
export function registerProviders(db = getDb()) {
  for (const p of PROVIDERS) {
    const mode = p.configured() ? "live" : "unavailable";
    db.prepare(
      `insert into sources (id, name, kind, tier, access_mode, last_error) values (?, ?, ?, ?, ?, ?)
       on conflict(id) do update set access_mode = excluded.access_mode`,
    ).run(p.id, p.name, p.kind, p.tier, mode, mode === "unavailable" ? "凭证未配置" : null);
  }
}

/** Real exchange tickers to sync: SYNC_CODES plus any real instrument linked to an event. Demo codes are skipped. */
export function syncCodes(db = getDb()): string[] {
  const env = (process.env.SYNC_CODES ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const linked = (db.prepare("select distinct code from event_instruments").all() as { code: string }[]).map((r) => r.code);
  return [...new Set([...env, ...linked])].filter((c) => /^\d{6}\.(SZ|SH|BJ)$/.test(c));
}

export type SyncResult = { sourceId: string; status: "ok" | "failed" | "busy"; added: number; duplicates: number; analyzed: number; errors: string[] };

export async function syncSource(id: string, db = getDb(), opts: { analyze?: boolean } = {}): Promise<SyncResult> {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown source ${id}`);
  registerProviders(db);
  const result: SyncResult = { sourceId: id, status: "ok", added: 0, duplicates: 0, analyzed: 0, errors: [] };
  const runId = randomUUID();
  db.prepare("insert into sync_runs (id, source_id, started_at, status) values (?, ?, ?, 'running')").run(runId, id, new Date().toISOString());

  const codes = syncCodes(db);
  if (!p.configured()) result.errors.push("凭证未配置");
  else if (!codes.length) result.errors.push("没有可同步的真实标的（设置 SYNC_CODES，如 300308.SZ）");
  let budget = opts.analyze === false ? 0 : MAX_ANALYZE_PER_RUN;
  for (const code of p.configured() ? codes : []) {
    let items: Omit<ImportInput, "source">[];
    try {
      items = await p.fetch(code);
    } catch (e) {
      // Upstream failure: keep old data and conclusions, record the error type.
      const err = e as { code?: string; message: string };
      result.errors.push(`${code}：${err.code ? `${err.code} ` : ""}${err.message}`);
      continue;
    }
    for (const item of items) {
      try {
        const r = importDocument({ ...item, source: { id }, subjectHint: code }, db);
        if (r.decision === "duplicate") {
          result.duplicates++;
          continue;
        }
        result.added++;
      } catch (e) {
        result.errors.push(`${code}《${item.title.slice(0, 30)}》：${(e as Error).message}`);
      }
    }
  }

  // Analyze oldest pending versions first so fresh arrivals cannot starve the backlog.
  // Failed versions are intentionally skipped; they can be retried via the UI.
  if (budget > 0) {
    const pending = db.prepare(
      `select v.id from document_versions v join documents d on d.id = v.document_id
       where d.source_id = ? and v.analysis_status = 'pending'
       order by v.fetched_at, v.rowid limit ?`,
    ).all(id, budget) as { id: string }[];
    for (const row of pending) {
      budget--;
      const a = await analyzeVersion(row.id, undefined, db);
      if (a.ok) result.analyzed++;
    }
  }

  result.status = result.errors.length && result.added + result.duplicates === 0 ? "failed" : "ok";
  const now = new Date().toISOString();
  const error = result.errors.join("；").slice(0, 2000) || null;
  db.prepare("update sync_runs set finished_at = ?, status = ?, added = ?, duplicates = ?, error = ? where id = ?").run(
    now, result.status, result.added, result.duplicates, error, runId,
  );
  if (result.status === "ok") db.prepare("update sources set last_success_at = ?, last_error = ? where id = ?").run(now, error?.slice(0, 500) ?? null, id);
  else db.prepare("update sources set last_error = ? where id = ?").run(error?.slice(0, 500) ?? "未知错误", id);
  return result;
}

/** Locked wrapper for the API and cron: returns status "busy" instead of overlapping. */
export async function lockedSync(ids: string[], db = getDb(), opts: { analyze?: boolean } = {}): Promise<SyncResult[]> {
  const release = acquireLock();
  if (!release) return ids.map((sourceId) => ({ sourceId, status: "busy", added: 0, duplicates: 0, analyzed: 0, errors: [] }));
  try {
    const out: SyncResult[] = [];
    for (const id of ids) out.push(await syncSource(id, db, opts));
    return out;
  } finally {
    release();
  }
}

export const configuredProviderIds = () => PROVIDERS.filter((p) => p.configured()).map((p) => p.id);
