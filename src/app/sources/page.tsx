import Link from "next/link";
import { formatTime } from "@/domain/time";
import { listPendingDocuments, listSources, listSyncRuns } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { registerProviders, syncCodes } from "@/server/sources/sync";
import { SourcesClient } from "./SourcesClient";

export const dynamic = "force-dynamic";

export default function SourcesPage() {
  const db = ensureSeeded();
  registerProviders(db);
  const codes = syncCodes(db);
  const pending = listPendingDocuments(db);
  return (
    <>
      <section className="hero hero-small">
        <p className="eyebrow">数据源</p>
        <h1>接入状态与同步记录</h1>
        <p className="lede">
          每个来源的接入方式、最近同步与错误。同步由服务器定时任务执行，也可用管理口令手动触发；接口失败时保留旧数据和旧结论。
        </p>
      </section>
      <p className="meta">同步标的：{codes.length ? codes.map((c) => <code key={c}>{c} </code>) : "无（构造数据使用演示代码，不调用真实接口）"}</p>
      <SourcesClient sources={listSources(db)} runs={listSyncRuns(db)} now={new Date().toISOString()} />

      <h2>同步收录、尚未归并的资料</h2>
      {pending.length === 0 ? (
        <p className="empty">没有待处理的同步资料。</p>
      ) : (
        <ul className="instruments">
          {pending.map((d) => (
            <li key={d.id}>
              <strong>{d.title}</strong>
              <span className={`tag${d.analysis_status === "failed" ? " tag-warn" : ""}`}>
                {d.analysis_status === "done" ? "已分析" : d.analysis_status === "failed" ? "分析失败" : "待分析"}
              </span>
              <p className="meta">
                {d.source_name} · 披露 {formatTime(d.published_at, "day")} · 抓取 {formatTime(d.fetched_at)} · <Link href={`/import?doc=${d.id}`}>分析与归并</Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
