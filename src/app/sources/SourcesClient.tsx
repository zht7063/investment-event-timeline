"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTime } from "@/domain/time";
import { TIER_LABEL } from "@/domain/types";

export type SourceRow = {
  id: string; name: string; kind: string; tier: number;
  access_mode: string; last_success_at: string | null; last_error: string | null;
};
export type SyncRunRow = {
  id: string; source_id: string; started_at: string; finished_at: string | null;
  status: string; added: number; duplicates: number; error: string | null;
};

const ACCESS_LABEL: Record<string, string> = {
  constructed: "构造演示数据",
  live: "真实接口",
  manual: "人工导入",
  unavailable: "未接入",
};
const RUN_LABEL: Record<string, string> = { ok: "成功", failed: "失败", running: "进行中" };
const RUN_BADGE: Record<string, string> = { ok: "supported", failed: "denied", running: "unverified" };

/** Sync results older than this are flagged as stale on the page. */
const STALE_MS = 24 * 3600_000;

export function SourcesClient({ sources, runs, now }: { sources: SourceRow[]; runs: SyncRunRow[]; now: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState("");
  const hasLive = sources.some((s) => s.access_mode === "live");

  async function sync(id: string) {
    if (!token.trim()) return setMsg({ ok: false, text: "请先填写管理口令（ADMIN_TOKEN）。" });
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(id)}/sync`, { method: "POST", headers: { authorization: `Bearer ${token.trim()}` } });
      const d = await res.json().catch(() => null);
      if (!res.ok) setMsg({ ok: false, text: `同步失败：${d?.error?.message ?? res.status}（${d?.error?.code ?? `HTTP_${res.status}`}）` });
      else if (d.status === "busy") setMsg({ ok: false, text: "已有同步在进行，本次未执行。" });
      else
        setMsg({
          ok: d.errors.length === 0,
          text: `同步完成：新增 ${d.added}，重复 ${d.duplicates}，已分析 ${d.analyzed}${d.errors.length ? `；${d.errors.length} 个错误，旧数据保留` : ""}`,
        });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "网络错误，请检查连接后重试。" });
    } finally {
      setBusy(null);
    }
  }

  if (!sources.length) return <p className="empty">尚无数据源。导入第一条资料后会自动创建来源。</p>;

  return (
    <>
      {hasLive && (
        <label className="admin-token">
          <span>管理口令（手动同步需要）</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </label>
      )}
      {msg && (
        <p className={msg.ok ? "meta" : "error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <ul className="instruments">
        {sources.map((s) => {
          const mine = runs.filter((r) => r.source_id === s.id);
          const stale = s.access_mode === "live" && (!s.last_success_at || Date.parse(now) - Date.parse(s.last_success_at) > STALE_MS);
          return (
            <li key={s.id}>
              <div className="source-head">
                <span>
                  <strong>{s.name}</strong>
                  <span className={`tag${s.access_mode === "unavailable" ? " tag-warn" : ""}`}>{ACCESS_LABEL[s.access_mode] ?? s.access_mode}</span>
                </span>
                {s.access_mode === "live" && (
                  <button type="button" className="ghost" disabled={busy !== null} onClick={() => sync(s.id)}>
                    {busy === s.id ? "同步中…" : "立即同步"}
                  </button>
                )}
              </div>
              <p className="meta">
                {TIER_LABEL[s.tier] ?? `等级 ${s.tier}`} · 最近成功同步：{formatTime(s.last_success_at)}
              </p>
              {stale && <p className="stale-banner">数据可能已过期：超过 24 小时没有成功同步。事件结论保留旧值，不代表事件已失效。</p>}
              {s.last_error && <p className="error">最近错误：{s.last_error}</p>}
              {mine.length > 0 && (
                <details>
                  <summary className="meta">同步记录（最近 {Math.min(mine.length, 10)} 次）</summary>
                  <ol className="runs">
                    {mine.slice(0, 10).map((r) => (
                      <li key={r.id}>
                        <span className={`badge badge-${RUN_BADGE[r.status] ?? "none"}`}>{RUN_LABEL[r.status] ?? r.status}</span>
                        <time dateTime={r.started_at}>{formatTime(r.started_at)}</time>
                        <span>新增 {r.added} · 重复 {r.duplicates}</span>
                        {r.error && <span className="muted">{r.error}</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
