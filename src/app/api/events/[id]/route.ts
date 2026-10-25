import { parseTime } from "@/domain/time";
import { fail, handleError } from "@/server/api";
import { getEventDetail } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  let asOf: string | null = null;
  try {
    asOf = parseTime(new URL(req.url).searchParams.get("asOf"))?.iso ?? null;
  } catch {
    return fail(400, "VALIDATION_FAILED", "asOf 时间无法解析");
  }
  try {
    const d = getEventDetail(id, asOf, ensureSeeded());
    return d ? Response.json(d) : fail(404, "NOT_FOUND", "事件不存在");
  } catch (e) {
    return handleError(e);
  }
}
