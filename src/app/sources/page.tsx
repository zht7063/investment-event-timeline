import { listSources } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { SourcesClient } from "./SourcesClient";

export const dynamic = "force-dynamic";

export default function SourcesPage() {
  const db = ensureSeeded();
  const sources = listSources(db);
  const syncRuns = db
    .prepare(
      `select source_id, started_at, finished_at, status, added, duplicates, error
       from sync_runs order by started_at desc limit 100`,
    )
    .all() as {
    source_id: string; started_at: string; finished_at: string | null;
    status: string; added: number; duplicates: number; error: string | null;
  }[];
  // node:sqlite rows have null prototype; convert to plain objects
  const plainSources = sources.map((s) => ({ ...s }));
  const plainRuns = syncRuns.map((r) => ({ ...r }));

  return (
    <>
      <section className="hero hero-small">
        <p className="eyebrow">Data Sources</p>
        <h1>Data Sources & Sync</h1>
        <p className="lede">
          Access mode, sync history, and errors for each data source. Live sources can be synced manually with an admin token.
        </p>
      </section>
      <SourcesClient sources={plainSources} syncRuns={plainRuns} />
    </>
  );
}
