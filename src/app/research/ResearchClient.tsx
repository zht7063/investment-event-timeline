"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  formatDisclosure,
  COVERAGE_LABEL,
  JOB_LABEL,
  SOURCE_LABEL,
} from "@/domain/research";
import { CATEGORY_LABEL, RELATION_LABEL } from "@/domain/types";
import { formatTime } from "@/domain/time";
import { StatusBadge } from "@/components/StatusBadge";
import type { researchStatus } from "@/server/research/store";
import type { concludeGroup } from "@/server/research/analysis";
type Data = NonNullable<ReturnType<typeof researchStatus>>;
type Event = ReturnType<typeof concludeGroup> & {
  relationStatus: string;
  relationError: string | null;
};
type Document = {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  body: string;
  published_at: string | null;
  content_kind: string;
  range_status: string;
  analysis_status: string;
  analysis: string | null;
  error: string | null;
};
const ANALYSIS_LABEL: Record<string, string> = {
  pending: "等待分析",
  done: "已分析",
  failed: "分析失败",
  excluded: "日期不明，未纳入区间结论",
};
export function ResearchClient({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [receivedAt, setReceivedAt] = useState<string | null>(null);
  const params = useSearchParams(),
    router = useRouter();
  const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
  const id = initial.job.id;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/research/${id}?offset=${offset}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error?.message || "读取任务失败");
        if (controller.signal.aborted) return;
        setData(result);
        setReceivedAt(new Date().toISOString());
        setError("");
        if (["queued", "running"].includes(result.job.status))
          timer = setTimeout(poll, 2000);
      } catch {
        if (!controller.signal.aborted)
          setError("暂时无法更新进度，下面保留上次结果。请检查连接后重试。");
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, offset, refresh]);
  async function action(kind: "cancel" | "retry" | "continue") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/research/${id}${kind === "cancel" ? "" : kind === "continue" ? "/retry?coverage=continue" : "/retry"}`,
        {
          method: kind === "cancel" ? "DELETE" : "POST",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) throw new Error();
      setRefresh((n) => n + 1);
    } catch {
      setError("操作结果尚未确认，请刷新任务状态后重试。");
    } finally {
      setBusy(false);
    }
  }
  const job = data.job,
    active = ["queued", "running"].includes(job.status);
  const events = (data.report?.body.events ?? []) as Event[];
  const documents = data.documents as unknown as Document[];
  const stage = job.status === "queued" ? "等待后台开始处理"
    : active ? ({ resolve: "核对股票代码与公司名称", fetch: "检索公告与新闻", analyze: "分析已收录资料", relations: "核验证据关系" }[job.phase] || "处理研究资料")
    : JOB_LABEL[job.status];
  const coverageGaps = data.sources.filter((s) => ["limited", "failed", "unavailable"].includes(s.status));
  const retrySources = data.sources.filter((source) => ["pending", "running", "failed", "unavailable"].includes(source.status));
  const unfinishedDocuments = data.counts.filter((row) => ["pending", "failed"].includes(row.status)).reduce((sum, row) => sum + row.count, 0);
  const unfinishedRelations = events.filter((event) => event.relationStatus !== "done").length;
  const retryParts = [
    retrySources.length ? `重新检索${retrySources.map((source) => SOURCE_LABEL[source.source_id]).join("、")}` : "",
    unfinishedDocuments ? `处理 ${unfinishedDocuments} 份待分析或失败资料` : "",
    unfinishedRelations ? `核验 ${unfinishedRelations} 个事项的证据关系` : "",
  ].filter(Boolean);
  const retryHint = retryParts.length
    ? `重试将${retryParts.join("；")}，保留已有结果。`
    : job.status === "failed" || job.status === "cancelled"
      ? "重试将从中断阶段恢复，保留已有资料与结果。"
      : "当前没有待重试的检索或分析失败；再次重试不会消除来源覆盖限制。";
  return (
    <>
      <Link href="/research#research-history" className="touch-link">返回研究记录</Link>
      <section className="hero hero-small">
        <h1>
          {job.name || (active ? "核对股票中" : "公司名称未核验")} <small>{job.code}</small>
        </h1>
        <p className="lede">
          披露日期 {job.start_day} 至 {job.end_day} · 北京时间
        </p>
      </section>
      <section className="research-progress" aria-label="任务进度">
        <div className="research-actions">
          <strong role="status">{JOB_LABEL[job.status]}</strong>
          <span>
            {data.total} 份资料 ·{" "}
            {data.counts.find((c) => c.status === "done")?.count ?? 0} 份已分析
          </span>
          {active ? (
            <button
              className="ghost research-stop"
              disabled={busy}
              onClick={() => void action("cancel")}
            >
              停止后续处理
            </button>
          ) : (
            ["failed", "partial", "cancelled"].includes(job.status) && (
              <button className="ghost research-retry" aria-describedby="research-retry-help" disabled={busy} onClick={() => void action("retry")}>
                重试未完成部分
              </button>
            )
          )}
          {!active && data.sources.some((s) => s.state.continuable) && (
            <button
              className="ghost"
              disabled={busy}
              onClick={() => void action("continue")}
            >
              继续检索更多资料
            </button>
          )}
        </div>
        {active && <p role="status" className="research-stage">{stage}</p>}
        <p className="hint">{receivedAt ? `页面最近同步 ${formatTime(receivedAt)}` : `任务最近更新 ${formatTime(job.updated_at)}`} · 北京时间</p>
        {active && <p className="hint">可以离开或刷新页面，任务会继续。返回研究记录即可继续查看。</p>}
        {!active && ["failed", "partial", "cancelled"].includes(job.status) && (
          <p className="hint" id="research-retry-help">
            {retryHint}
            {data.sources.some((source) => source.state.continuable) && " 如需扩大检索范围，请选择“继续检索更多资料”；仍不保证穷尽。"}
          </p>
        )}
        {job.error && <p role="alert">{job.error}</p>}
        {error && (
          <p role="alert">
            {error}{" "}
            <button className="ghost" onClick={() => setRefresh((n) => n + 1)}>
              重新读取
            </button>
          </p>
        )}
      </section>
      <nav className="research-actions section-jumps" aria-label="研究内容导航">
        <a href="#research-findings">事件与事实变化</a>
        <a href="#research-documents">已收录资料</a>
        <a href="#research-coverage">来源覆盖</a>
      </nav>
      <section id="research-coverage" className="coverage-summary" aria-label="来源覆盖">
        <p className={coverageGaps.length ? "coverage-warning" : "hint"}>
          {coverageGaps.length ? "覆盖缺口：" : "来源覆盖："}
          {(coverageGaps.length ? coverageGaps : data.sources).map((source) => `${SOURCE_LABEL[source.source_id]}（${COVERAGE_LABEL[source.status]}${source.error ? `：${source.error}` : ""}）`).join("；")}
          {coverageGaps.length ? "。结果可能不完整。" : "。检索结果不保证穷尽。"}
        </p>
        <details>
        <summary>查看来源覆盖明细与限制</summary>
        <ul className="research-sources">
          {data.sources.map((source) => (
            <li key={source.source_id}>
              <div>
                <strong>{SOURCE_LABEL[source.source_id]}</strong>
                <span className="tag">{COVERAGE_LABEL[source.status]}</span>
              </div>
              <p className="hint">
                {source.state.requests} 次检索 · 返回 {source.state.received} 条
                · 区间外排除 {source.state.excluded} 条 · 日期不明{" "}
                {source.state.unknownDates} 条
              </p>
              {source.error && <p className="field-error">{source.error}</p>}
              {source.state.warnings.map((w) => (
                <p className="hint" key={w}>
                  {w}
                </p>
              ))}
            </li>
          ))}
        </ul>
        </details>
      </section>
      <section id="research-findings">
        <h2>
          事件与事实变化 <span className="count">{events.length} 个事项</span>
        </h2>
        <p className="hint">
          基于片段或摘要的自动分析，未经人工确认或全文核验。
        </p>
        {!events.length && (
          <div className="empty">
            {active
              ? "正在检索和分析，识别到可验证事项后会在这里显示。"
              : "尚未形成可验证的事件。请查看资料、覆盖缺口或失败原因；这不代表区间内没有事件。"}
          </div>
        )}
        {events.map((event) => (
          <article className="research-event" key={event.id}>
            <div>
              {event.relationStatus === "done" ? (
                <StatusBadge status={event.conclusion.status} />
              ) : (
                <span className="badge badge-unverified">
                  {event.relationStatus === "failed"
                    ? "关系待核实"
                    : active
                      ? "初步提取 · 关系分析中"
                      : "初步提取 · 关系未核验"}
                </span>
              )}
              <span className="tag">自动分析</span>
            </div>
            <h3>{event.title}</h3>
            <p className="hint">
              {event.merge} · 最早已收录披露{" "}
              {formatTime(event.firstDisclosedAt, "day")}
            </p>
            {event.relationStatus === "done" && (
              <ul>
                {event.conclusion.summary.map((line, i) => (
                  <li key={i}>
                    {line.text}{" "}
                    <span className="research-citations">
                      {line.evidenceIds.map((ref, j) => (
                        <a href={`#evidence-${ref}`} key={ref}>
                          证据 {j + 1}
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {event.relationStatus === "done" &&
              event.conclusion.missing.map((message) => (
                <p className="hint" key={message}>
                  {message}
                </p>
              ))}
            {event.relationError && (
              <p className="field-error">{event.relationError}</p>
            )}
            {event.warnings.map((w) => (
              <p className="hint" key={w}>
                {w}
              </p>
            ))}
            {event.conclusion.conflicts.length > 0 && (
              <p className="field-error">
                存在 {event.conclusion.conflicts.length}{" "}
                组冲突，支持和反驳摘录均保留。
              </p>
            )}
            <details>
              <summary>查看 {event.evidence.length} 条证据与时间线</summary>
              <ol className="research-evidence">
                {event.evidence.map((e) => (
                  <li key={e.id} id={`evidence-${e.id}`}>
                    <p className="evidence-disclosure">
                      <span>披露</span> <strong>{formatTime(e.publishedAt, e.publishedPrecision)}</strong>
                    </p>
                    <p className="hint evidence-source">
                      <strong>{CATEGORY_LABEL[e.category]}</strong> ·{" "}
                      {RELATION_LABEL[e.relation]} · {e.sourceName}
                    </p>
                    <dl className="hint evidence-times">
                      <div><dt>发生</dt><dd>{formatTime(e.occurredAt, e.occurredPrecision)}</dd></div>
                      <div><dt>抓取</dt><dd>{formatTime(e.fetchedAt)}</dd></div>
                      <div><dt>来源更新</dt><dd>未知</dd></div>
                    </dl>
                    <blockquote>{e.quote}</blockquote>
                    <p className="hint">
                      {e.reason}
                      {e.targetClaimId && (
                        <>
                          {" "}
                          ·{" "}
                          <a href={`#evidence-${e.targetClaimId}`}>目标论断</a>
                        </>
                      )}
                    </p>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer">
                        打开来源页面 ↗
                      </a>
                    ) : (
                      <span className="hint">供应商未提供原始链接</span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </article>
        ))}
      </section>
      <section id="research-documents">
        <h2>已收录资料</h2>
        <p className="count">
          共 {data.total} 份，当前 {documents.length ? data.offset + 1 : 0}–
          {documents.length ? data.offset + documents.length : 0}
        </p>
        {documents.map((doc) => (
          <details className="research-document" key={doc.id}>
            <summary>
              {doc.title}{" "}
              <span className="tag">{ANALYSIS_LABEL[doc.analysis_status]}</span>
              <span className="hint research-document-meta">
                披露 {formatDisclosure(doc.published_at)} · {doc.publisher || "来源未标明"} ·{" "}
                {doc.content_kind === "snippet" ? "片段" : "摘要"}
              </span>
            </summary>
            <p className="research-body">{doc.body}</p>
            {doc.analysis && (
              <p className="hint">
                关联判断：{JSON.parse(doc.analysis).reason}。
                {JSON.parse(doc.analysis).warnings.join("；")}
              </p>
            )}
            {doc.error && <p className="field-error">{doc.error}</p>}
            {doc.url && (
              <a href={doc.url} target="_blank" rel="noreferrer">
                打开来源页面 ↗
              </a>
            )}
          </details>
        ))}
        {!documents.length && (
          <p className="empty">{data.total ? "当前页没有资料，请返回上一页。" : "尚无已收录资料。请查看上方检索状态。"}</p>
        )}
        {(data.total > 20 || (data.total > 0 && offset > 0)) && <nav className="research-actions" aria-label="资料分页">
          <button
            className="ghost"
            disabled={offset === 0}
            onClick={() =>
              router.replace(`?offset=${Math.max(0, Math.min(offset - 20, Math.floor((data.total - 1) / 20) * 20))}`, {
                scroll: false,
              })
            }
          >
            上一页
          </button>
          <button
            className="ghost"
            disabled={offset + 20 >= data.total}
            onClick={() =>
              router.replace(`?offset=${offset + 20}`, { scroll: false })
            }
          >
            下一页
          </button>
        </nav>}
      </section>
    </>
  );
}
