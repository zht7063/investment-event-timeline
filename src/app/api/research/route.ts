import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ResearchInput } from "@/domain/research";
import { fail, readJson } from "@/server/api";
import { createResearch } from "@/server/research/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const p = await readJson(req, ResearchInput);
  if (!p.ok) return p.res;
  const key = req.headers.get("idempotency-key") || randomUUID();
  if (
    !z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .safeParse(key).success
  )
    return fail(400, "INVALID_KEY", "请求标识无效");
  try {
    const job = createResearch(p.data, key);
    return Response.json({ id: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return fail(
      409,
      "RESEARCH_CONFLICT",
      error instanceof Error ? error.message : "无法创建研究任务",
    );
  }
}
