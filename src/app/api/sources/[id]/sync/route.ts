import { fail, handleError, requireAdmin } from "@/server/api";
import { ensureSeeded } from "@/server/seed";
import { syncIfind, syncFuyao } from "@/server/sources/sync";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const db = ensureSeeded();
  try {
    let result;
    if (id === "ifind-mcp") {
      result = await syncIfind(db);
    } else if (id === "fuyao-rest") {
      result = await syncFuyao(db);
    } else {
      return fail(404, "NOT_FOUND", "unknown source id");
    }
    return Response.json(result);
  } catch (e) {
    return handleError(e);
  }
}
