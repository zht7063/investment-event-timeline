import { fail, handleError, requireAdmin } from "@/server/api";
import { analyzeVersion } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BATCH = 20;

/**
 * POST /api/sources/analyze-pending
 * Requires ADMIN_TOKEN. Analyzes up to 20 pending versions.
 * Optional body: { sourceId?: string, versionId?: string }
 * - versionId: retry a single version (including failed ones)
 * - sourceId: batch-analyze pending versions from one source
 * - neither: batch-analyze all pending versions
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let sourceId: string | undefined;
  let versionId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : undefined;
    versionId = typeof body.versionId === "string" ? body.versionId.trim() : undefined;
  } catch { /* empty body is fine */ }

  const db = ensureSeeded();

  try {
    // Single version retry (works for both pending and failed)
    if (versionId) {
      const row = db.prepare(
        "select id, analysis_status from document_versions where id = ?",
      ).get(versionId) as { id: string; analysis_status: string } | undefined;
      if (!row) return fail(404, "NOT_FOUND", "版本不存在");
      if (row.analysis_status === "done") return Response.json({ analyzed: 0, failed: 0, message: "已分析，无需重试" });
      const r = await analyzeVersion(row.id, undefined, db);
      return Response.json({ analyzed: r.ok ? 1 : 0, failed: r.ok ? 0 : 1 });
    }

    // Batch: pending versions, optionally filtered by source
    const where = sourceId
      ? "d.source_id = ? and v.analysis_status = 'pending'"
      : "v.analysis_status = 'pending'";
    const params = sourceId ? [sourceId, MAX_BATCH] : [MAX_BATCH];
    const rows = db.prepare(
      `select v.id from document_versions v join documents d on d.id = v.document_id
       where ${where} order by v.fetched_at limit ?`,
    ).all(...params) as { id: string }[];

    let analyzed = 0;
    let failed = 0;
    for (const row of rows) {
      const r = await analyzeVersion(row.id, undefined, db);
      if (r.ok) analyzed++;
      else failed++;
    }
    return Response.json({ analyzed, failed, total: rows.length });
  } catch (e) {
    return handleError(e);
  }
}
