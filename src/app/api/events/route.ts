import { Status } from "@/domain/types";
import { fail, handleError } from "@/server/api";
import { searchEvents } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const status = p.get("status");
  if (status && !Status.safeParse(status).success) return fail(400, "VALIDATION_FAILED", "未知状态");
  try {
    return Response.json(
      searchEvents(
        {
          text: p.get("q")?.slice(0, 50) || undefined,
          status: (status as Status) || undefined,
          codes: p.get("codes")?.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 50),
          limit: Number(p.get("limit")) || undefined,
          offset: Number(p.get("offset")) || undefined,
        },
        ensureSeeded(),
      ),
    );
  } catch (e) {
    return handleError(e);
  }
}
