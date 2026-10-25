import { handleError, requireAdmin } from "@/server/api";
import { getDb } from "@/server/db";
import { resetToSeed } from "@/server/seed";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    resetToSeed(getDb());
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
