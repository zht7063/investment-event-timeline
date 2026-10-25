import { fail, handleError } from "@/server/api";
import { getPriceSnapshot, isConfigured } from "@/server/sources/fuyao";

export const dynamic = "force-dynamic";

/** GET /api/prices?codes=300308.SZ,600519.SH - background market data, not evidence. */
export async function GET(req: Request) {
  const codes = new URL(req.url).searchParams.get("codes")?.split(",").map((c) => c.trim()).filter(Boolean);
  if (!codes?.length) return fail(400, "VALIDATION_FAILED", "codes parameter required");
  if (!isConfigured()) return Response.json({ prices: [], unavailable: true });
  try {
    const prices = await getPriceSnapshot(codes.slice(0, 20));
    return Response.json({ prices, unavailable: false });
  } catch (e) {
    return handleError(e);
  }
}
