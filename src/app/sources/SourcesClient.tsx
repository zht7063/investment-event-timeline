"use client";

import { useState } from "react";

type Source = {
  id: string; name: string; kind: string; tier: number;
  access_mode: string; last_success_at: string | null; last_error: string | null;
};
type SyncRun = {
  source_id: string; started_at: string; finished_at: string | null;
  status: string; added: number; duplicates: number; error: string | null;
};

const ACCESS_LABEL: Record<string, string> = {
  constructed: "constructed demo data",
  live: "live API",
  manual: "manual import",
  unavailable: "unavailable",
};

const KIND_LABEL: Record<string, string> = {
  regulator: "regulator/exchange",
  issuer: "issuer/company",
  media: "media",
  research: "research/commentary",
  rumor: "anonymous/rumor",
  market_data: "market data",
  manual: "manual entry",
};

function formatTime(iso: string | null): string {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch {
    return iso;
  }
}

export function SourcesClient({ sources, syncRuns }: { sources: Source[]; syncRuns: SyncRun[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const syncable = sources.filter((s) => s.access_mode === "live");
  const runsBySource = new Map<string, SyncRun[]>();
  for (const r of syncRuns) {
    const list = runsBySource.get(r.source_id) ?? [];
    list.push(r);
    runsBySource.set(r.source_id, list);
  }

  async function triggerSync(sourceId: string) {
    if (!token.trim()) {
      setResult("Please enter the ADMIN_TOKEN first.");
      return;
    }
    setBusy(sourceId);
    setResult(null);
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/sync`, {
        method: "POST",
        headers: { authorization: `Bearer ${token.trim()}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Sync failed: ${data.error?.message ?? res.statusText}`);
      } else {
        setResult(`Sync complete: +${data.added} new, ${data.duplicates} duplicates${data.errors?.length ? `, ${data.errors.length} errors` : ""}`);
      }
    } catch {
      setResult("Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {syncable.length > 0 && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <label>
            <span>Admin Token (for manual sync)</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ADMIN_TOKEN"
              autoComplete="off"
              style={{ maxWidth: "360px" }}
            />
          </label>
        </div>
      )}

      {result && <p className={result.includes("failed") || result.includes("error") ? "error" : "meta"} role="status">{result}</p>}

      <ul className="instruments">
        {sources.map((s) => (
          <li key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <strong>{s.name}</strong>
                <span className="tag">{ACCESS_LABEL[s.access_mode] ?? s.access_mode}</span>
              </div>
              {s.access_mode === "live" && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy === s.id}
                  onClick={() => triggerSync(s.id)}
                >
                  {busy === s.id ? "Syncing..." : "Sync now"}
                </button>
              )}
            </div>
            <p className="meta">
              Type: {KIND_LABEL[s.kind] ?? s.kind} &middot; Tier {s.tier}
              {s.last_success_at && <> &middot; Last sync: {formatTime(s.last_success_at)}</>}
            </p>
            {s.last_error && <p className="error" style={{ marginTop: "0.3rem" }}>{s.last_error}</p>}

            {(runsBySource.get(s.id) ?? []).length > 0 && (
              <details style={{ marginTop: "0.4rem" }}>
                <summary className="meta" style={{ cursor: "pointer" }}>
                  Sync history ({runsBySource.get(s.id)!.length} runs)
                </summary>
                <ol style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", fontSize: "0.85rem", fontFamily: "var(--sans)" }}>
                  {runsBySource.get(s.id)!.slice(0, 10).map((r, i) => (
                    <li key={i} style={{ padding: "0.2rem 0", borderBottom: "1px dotted var(--line)" }}>
                      <span className={`badge badge-${r.status === "ok" ? "supported" : r.status === "failed" ? "denied" : "unverified"}`}>
                        {r.status}
                      </span>
                      {" "}{formatTime(r.started_at)}
                      {r.finished_at && <> &rarr; {formatTime(r.finished_at)}</>}
                      {" &middot; "}+{r.added} / {r.duplicates} dup
                      {r.error && <span style={{ color: "var(--s-denied)" }}> &middot; {r.error}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </li>
        ))}
      </ul>

      {sources.length === 0 && (
        <div className="empty">
          No data sources configured yet. Import your first document or set up iFinD/Fuyao API keys.
        </div>
      )}
    </>
  );
}
