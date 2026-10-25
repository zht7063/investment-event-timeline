"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime } from "@/domain/time";
import type { EventSummary } from "@/server/repo";

const KEY = "watchlist:v1";
// Constructed demo portfolio; no holdings are collected.
const DEFAULT_WATCH = ["DEMO-A"];

export function EventList({ items, total, filtered }: { items: EventSummary[]; total: number; filtered: boolean }) {
  const [watch, setWatch] = useState<string[] | null>(null);
  const [onlyWatched, setOnlyWatched] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      setWatch(Array.isArray(saved) ? saved.filter((s) => typeof s === "string") : DEFAULT_WATCH);
    } catch {
      setWatch(DEFAULT_WATCH);
    }
  }, []);

  const save = (next: string[]) => {
    setWatch(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };
  const codesOf = (e: EventSummary) => (e.instruments ?? "").split(",").filter(Boolean);
  const shown = onlyWatched && watch ? items.filter((e) => codesOf(e).some((c) => watch.includes(c))) : items;

  return (
    <>
      <section className="watch" aria-label="关注清单">
        <div className="watch-head">
          <h2>关注清单</h2>
          <label className="toggle">
            <input type="checkbox" checked={onlyWatched} onChange={(e) => setOnlyWatched(e.target.checked)} disabled={!watch} />
            只看关注标的
          </label>
        </div>
        <ul className="chips">
          {(watch ?? []).map((c) => (
            <li key={c}>
              <span>{c}</span>
              <button type="button" aria-label={`移除 ${c}`} onClick={() => save(watch!.filter((x) => x !== c))}>
                ×
              </button>
            </li>
          ))}
          {watch?.length === 0 && <li className="muted">清单为空</li>}
        </ul>
        <form
          className="watch-add"
          onSubmit={(e) => {
            e.preventDefault();
            const c = draft.trim().toUpperCase();
            if (c && watch && !watch.includes(c)) save([...watch, c]);
            setDraft("");
          }}
        >
          <label>
            <span className="sr-only">添加标的代码</span>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="添加代码，如 DEMO-M" maxLength={32} />
          </label>
          <button type="submit">添加</button>
        </form>
        <p className="hint">清单只保存在本浏览器，不上传、不记录持仓。</p>
      </section>

      <section aria-live="polite">
        <p className="count">
          共 {total} 个事件{onlyWatched ? `，关注标的相关 ${shown.length} 个` : ""}
        </p>
        {shown.length === 0 ? (
          <div className="empty">
            {onlyWatched && items.length > 0
              ? "当前关注清单中的标的没有关联事件。可添加代码或关闭“只看关注标的”。"
              : filtered
                ? "没有符合搜索或状态条件的事件。"
                : "暂无事件。可在“导入资料”中添加第一条资料。"}
          </div>
        ) : (
          <ol className="event-list">
            {shown.map((e, i) => (
              <li key={e.id} style={{ animationDelay: `${i * 60}ms` }}>
                <Link href={`/events/${e.id}`} className="event-card">
                  <div className="event-card-top">
                    <StatusBadge status={e.status} />
                    {e.is_constructed === 1 && <span className="tag">构造数据</span>}
                  </div>
                  <h3>{e.title}</h3>
                  <p className="meta">
                    {codesOf(e).join(" · ")} · {e.evidence_count} 条证据 · 结论更新于 {formatTime(e.generated_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
