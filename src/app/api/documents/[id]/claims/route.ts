import { z } from "zod";
import { fail, handleError, readJson } from "@/server/api";
import { addManualClaim } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";
import { latestVersion, versionPreview } from "@/server/versions";

export const dynamic = "force-dynamic";

// Shape is re-validated by validateClaims (same rules as model output); this only bounds size.
const Body = z.object({ claim: z.record(z.string(), z.unknown()) });

export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/claims">) {
  const { id } = await ctx.params;
  const p = await readJson(req, Body);
  if (!p.ok) return p.res;
  const db = ensureSeeded();
  const v = latestVersion(id, db);
  if (!v) return fail(404, "NOT_FOUND", "资料不存在");
  try {
    addManualClaim(v.id, p.data.claim, db);
    return Response.json(versionPreview(v.id, db), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
