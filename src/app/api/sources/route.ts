import { handleError } from "@/server/api";
import { listSources } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = ensureSeeded();
    const sources = listSources(db);
    const syncRuns = db
      .prepare(
        `select sr.source_id, sr.started_at, sr.finished_at, sr.status, sr.added, sr.duplicates, sr.error
         from sync_runs sr order by sr.started_at desc limit 100`,
      )
      .all() as {
      source_id: string; started_at: string; finished_at: string | null;
      status: string; added: number; duplicates: number; error: string | null;
    }[];
    return Response.json({ sources, syncRuns });
  } catch (e) {
    return handleError(e);
  }
}
