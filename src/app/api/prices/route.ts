import { fail, handleError } from "@/server/api";
import { getPriceSnapshot, isConfigured } from "@/server/sources/fuyao";

export const dynamic = "force-dynamic";

/** GET /api/prices?codes=300308.SZ,600519.SH - background market data, not evidence. */
export async function GET(req: Request) {
  const TICKER_RE = /^\d{6}\.(SZ|SH|BJ)$/;
  const raw = new URL(req.url).searchParams.get("codes")?.split(",").map((c) => c.trim()).filter(Boolean);
  if (!raw?.length) return fail(400, "VALIDATION_FAILED", "codes parameter required");
  const codes = [...new Set(raw.filter((c) => TICKER_RE.test(c)))];
  if (!codes.length) return fail(400, "VALIDATION_FAILED", "no valid ticker codes (expected format: 300308.SZ)");
  if (!isConfigured()) return Response.json({ prices: [], unavailable: true });
  try {
    const prices = await getPriceSnapshot(codes.slice(0, 20));
    // Only return rows whose code matches a requested ticker.
    const requested = new Set(codes.slice(0, 20));
    const filtered = prices.filter((p) => requested.has(p.code));
    return Response.json({ prices: filtered, unavailable: false });
  } catch (e) {
    return handleError(e);
  }
}
