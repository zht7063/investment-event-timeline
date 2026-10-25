import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// Health check only touches the local DB; it never calls paid providers.
export function GET() {
  try {
    getDb().prepare("select 1").get();
    return Response.json({ ok: true, db: "ok", time: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false, db: "error", code: "DB_UNAVAILABLE" }, { status: 503 });
  }
}
