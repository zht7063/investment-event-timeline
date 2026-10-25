import { fail, handleError, requireAdmin } from "@/server/api";
import { ensureSeeded } from "@/server/seed";
import { lockedSync, PROVIDERS } from "@/server/sources/sync";

export const dynamic = "force-dynamic";
// Provider calls plus up to 5 model analyses can take a while.
export const maxDuration = 300;

/** Manual sync (ADMIN_TOKEN). Same code path as the cron script. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!PROVIDERS.some((p) => p.id === id)) return fail(404, "NOT_FOUND", "该来源不支持同步");
  try {
    const [r] = await lockedSync([id], ensureSeeded());
    return Response.json(r);
  } catch (e) {
    return handleError(e);
  }
}
