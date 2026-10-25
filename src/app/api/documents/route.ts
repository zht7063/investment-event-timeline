import { z } from "zod";
import { SourceKind } from "@/domain/types";
import { handleError, MAX_BODY_CHARS, readJson } from "@/server/api";
import { importDocument } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

const Body = z.object({
  source: z.union([z.object({ id: z.string().min(1).max(64) }), z.object({ name: z.string().trim().min(1).max(60), kind: SourceKind })]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1, "正文为空").max(MAX_BODY_CHARS, `正文不能超过 ${MAX_BODY_CHARS} 字`),
  url: z.url({ protocol: /^https?$/ }).max(500).nullish().or(z.literal("")),
  repostedFromId: z.string().max(64).nullish(),
  publishedAt: z.string().max(40).nullish(),
  sourceUpdatedAt: z.string().max(40).nullish(),
});

// URL is stored as provenance only; the server never fetches it.
export async function POST(req: Request) {
  const p = await readJson(req, Body);
  if (!p.ok) return p.res;
  try {
    const r = importDocument({ ...p.data, url: p.data.url || null }, ensureSeeded());
    return Response.json(r, { status: r.decision === "duplicate" ? 200 : 201 });
  } catch (e) {
    if (e instanceof Error && /无法解析时间|无效日期/.test(e.message)) return Response.json({ error: { code: "VALIDATION_FAILED", message: e.message } }, { status: 400 });
    return handleError(e);
  }
}
