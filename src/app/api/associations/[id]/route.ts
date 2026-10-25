import { handleError } from "@/server/api";
import { revoke } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

/** Revoke, not delete: the link keeps a revoked_at timestamp and the event is recomputed. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/associations/[id]">) {
  const { id } = await ctx.params;
  try {
    return Response.json(revoke(id, ensureSeeded()));
  } catch (e) {
    return handleError(e);
  }
}
