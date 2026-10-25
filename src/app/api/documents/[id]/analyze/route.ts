import { fail, handleError } from "@/server/api";
import { analyzeVersion } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";
import { latestVersion, versionPreview } from "@/server/versions";

export const dynamic = "force-dynamic";

/** Analyze the latest version. Model failures return 502 with a code; the document stays and can be retried. */
export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/analyze">) {
  const { id } = await ctx.params;
  // Optional ?subject=CODE hint for documents that never name their ticker.
  const subject = new URL(req.url).searchParams.get("subject")?.trim().slice(0, 32) || null;
  const db = ensureSeeded();
  const v = latestVersion(id, db);
  if (!v) return fail(404, "NOT_FOUND", "资料不存在");
  try {
    const r = await analyzeVersion(v.id, undefined, db, subject);
    const preview = versionPreview(v.id, db);
    if (!r.ok) return fail(r.code === "AI_NOT_CONFIGURED" ? 503 : 502, r.code, r.error, { preview });
    return Response.json(preview);
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/analyze">) {
  const { id } = await ctx.params;
  const db = ensureSeeded();
  const v = latestVersion(id, db);
  return v ? Response.json(versionPreview(v.id, db)) : fail(404, "NOT_FOUND", "资料不存在");
}
