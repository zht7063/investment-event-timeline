import { fail } from "@/server/api";
import { researchStatus } from "@/server/research/store";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params,
    result = researchStatus(id);
  return result
    ? Response.json(
        { status: result.job.status, report: result.report },
        { headers: { "cache-control": "no-store" } },
      )
    : fail(404, "NOT_FOUND", "研究任务不存在");
}
