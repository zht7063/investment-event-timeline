import { fail } from "@/server/api";
import { cancelResearch, researchStatus } from "@/server/research/store";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  const { id } = await ctx.params;
  const offset = Math.max(
    0,
    Math.floor(Number(new URL(req.url).searchParams.get("offset")) || 0),
  );
  if (!Number.isSafeInteger(offset))
    return fail(400, "INVALID_OFFSET", "分页参数无效");
  const result = researchStatus(id, undefined, offset);
  return result
    ? Response.json(result, { headers: { "cache-control": "no-store" } })
    : fail(404, "NOT_FOUND", "研究任务不存在");
}
export async function DELETE(_req: Request, ctx: Context) {
  const { id } = await ctx.params,
    job = cancelResearch(id);
  return job
    ? Response.json({ id, status: job.status })
    : fail(404, "NOT_FOUND", "研究任务不存在");
}
