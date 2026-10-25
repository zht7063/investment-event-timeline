import { fail } from "@/server/api";
import { retryResearch } from "@/server/research/store";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params,
    job = retryResearch(
      id,
      undefined,
      new URL(req.url).searchParams.get("coverage") === "continue",
    );
  return job
    ? Response.json({ id, status: job.status })
    : fail(404, "NOT_FOUND", "研究任务不存在");
}
