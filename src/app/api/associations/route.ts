import { z } from "zod";
import { Relation } from "@/domain/types";
import { handleError, readJson } from "@/server/api";
import { associate } from "@/server/ingest";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    eventId: z.string().max(64).nullish(),
    newEvent: z
      .object({
        title: z.string().trim().min(1).max(100),
        eventType: z.string().trim().min(1).max(32),
        subjectCode: z.string().trim().min(1).max(32),
        matterKey: z.string().trim().min(1).max(100),
        instrumentName: z.string().trim().max(60).nullish(),
      })
      .nullish(),
    links: z
      .array(z.object({ claimId: z.string().max(64), relation: Relation, targetClaimId: z.string().max(64).nullish(), reason: z.string().trim().min(1, "需要填写关联理由").max(300) }))
      .min(1)
      .max(30),
  })
  .refine((b) => Boolean(b.eventId) !== Boolean(b.newEvent), "eventId 与 newEvent 必须二选一");

export async function POST(req: Request) {
  const p = await readJson(req, Body);
  if (!p.ok) return p.res;
  try {
    return Response.json(associate(p.data, ensureSeeded()), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
