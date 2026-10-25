import { getDb } from "./db";
import type { StoredAnalysis } from "./ingest";

export type ClaimRow = { id: string; quote: string; quote_start: number; category: string; content: string; occurred_at: string | null; occurred_precision: string | null; valid_until: string | null; linked: number };

/** Latest version of a document, for analysis and the import preview. */
export function latestVersion(documentId: string, db = getDb()) {
  return db
    .prepare("select id, body, analysis_status, analysis_error, analysis from document_versions where document_id = ? order by fetched_at desc, rowid desc limit 1")
    .get(documentId) as { id: string; body: string; analysis_status: string; analysis_error: string | null; analysis: string | null } | undefined;
}

export function versionPreview(versionId: string, db = getDb()) {
  const v = db.prepare("select id, analysis_status, analysis_error, analysis from document_versions where id = ?").get(versionId) as
    | { id: string; analysis_status: string; analysis_error: string | null; analysis: string | null }
    | undefined;
  if (!v) return null;
  const claims = db
    .prepare(
      `select c.id, c.quote, c.quote_start, c.category, c.content, c.occurred_at, c.occurred_precision, c.valid_until,
              exists (select 1 from event_evidence ee where ee.claim_id = c.id and ee.revoked_at is null) as linked
       from claims c where c.version_id = ? order by c.quote_start`,
    )
    .all(versionId) as ClaimRow[];
  return {
    versionId: v.id,
    status: v.analysis_status,
    error: v.analysis_error,
    analysis: v.analysis ? (JSON.parse(v.analysis) as StoredAnalysis) : null,
    claims,
  };
}
