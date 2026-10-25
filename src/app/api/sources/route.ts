import { handleError } from "@/server/api";
import { listSources, listSyncRuns } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { registerProviders } from "@/server/sources/sync";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = ensureSeeded();
    registerProviders(db);
    return Response.json({ sources: listSources(db), runs: listSyncRuns(db) });
  } catch (e) {
    return handleError(e);
  }
}
