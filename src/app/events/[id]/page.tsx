import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime, parseTime } from "@/domain/time";
import { CATEGORY_LABEL, RELATION_LABEL, TIER_LABEL, type ConflictCard, type SummaryLine } from "@/domain/types";
import { getEventDetail, type EvidenceRow } from "@/server/repo";
import { ensureSeeded } from "@/server/seed";
import { RevokeButton } from "./RevokeButton";
import { MarketBackground } from "./MarketBackground";

export const dynamic = "force-dynamic";

const toBeijingInput = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, -1);

export default async function EventPage({ params, searchParams }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const axis = sp.axis === "occurred" ? "occurred" : "published";
  let asOf: string | null = null;
  let asOfError = false;
  try {
    asOf = typeof sp.asOf === "string" ? (parseTime(sp.asOf)?.iso ?? null) : null;
  } catch {
    asOfError = true;
  }
  const d = getEventDetail(decodeURIComponent(id), asOf, ensureSeeded());
  if (!d) notFound();

  const { event, conclusion, evidence } = d;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const byClaim = new Map(evidence.map((e) => [e.claimId, e]));
  const visible = evidence.filter((e) => e.fetchedAt <= d.asOf && e.createdAt <= d.asOf);
  const latestFetch = visible.reduce<string | null>((m, e) => (!m || e.fetchedAt > m ? e.fetchedAt : m), null);
  const STALE_MS = 7 * 86400_000;
  const stale = !d.isHistorical && event.is_constructed !== 1 && latestFetch && Date.now() - Date.parse(latestFetch) > STALE_MS;
  const status = (e: EvidenceRow) =>
    e.revokedAt && e.revokedAt <= d.asOf
      ? "已撤销"
      : conclusion.supersededIds.includes(e.id)
        ? "已被更正/替代"
        : conclusion.expiredIds.includes(e.id)
          ? "已过有效期"
          : null;

  const timeOf = (e: EvidenceRow) => (axis === "occurred" ? e.occurredAt : e.publishedAt);
  const known = visible.filter((e) => timeOf(e)).sort((a, b) => timeOf(a)!.localeCompare(timeOf(b)!) || a.fetchedAt.localeCompare(b.fetchedAt));
  const unknown = visible.filter((e) => !timeOf(e));
  const earliest = [...visible].filter((e) => e.publishedAt).sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!))[0];
  const base = `/events/${event.id}`;
  const q = (o: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const merged = { axis, asOf: d.isHistorical ? toBeijingInput(d.asOf) : null, ...o };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "axis" && v === "published")) u.set(k, v);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <article className="detail">
      <p className="crumbs">
        <Link href="/">事件</Link> / {event.subject_code}
      </p>
      <header className="detail-head">
        <div>
          <h1>{event.title}</h1>
          <p className="meta">
            事项标识 <code>{event.matter_key}</code> · 类型 {event.event_type}
            {event.is_constructed === 1 && <span className="tag">构造演示数据，非真实证券</span>}
          </p>
        </div>
      </header>

      <form className="asof" method="get" action={base}>
        <input type="hidden" name="axis" value={axis} />
        <label>
          <span>截至某时回看（北京时间）</span>
          <input type="datetime-local" name="asOf" step="0.001" defaultValue={d.isHistorical ? toBeijingInput(d.asOf) : ""} />
        </label>
        <button type="submit">回看</button>
        {d.isHistorical && <Link href={q({ asOf: null })}>回到当前</Link>}
        {asOfError && <p className="error" role="alert">时间无法解析，已显示当前结论。</p>}
      </form>

      <section className={`verdict verdict-${conclusion.status}`} aria-labelledby="verdict-h">
        <div className="verdict-top">
          <h2 id="verdict-h">{d.isHistorical ? "当时的判断" : "当前判断"}</h2>
          <StatusBadge status={conclusion.status} />
        </div>
        <p className="asof-line">
          截至 {formatTime(d.asOf)}
          {d.isHistorical ? "（历史回看：只使用当时已抓取的证据）" : ""}
        </p>
        {stale && <p className="stale-banner">数据可能已过期：最近一条证据的抓取时间为 {formatTime(latestFetch)}，超过 7 天没有新数据。结论保留旧值，接口失败不等于事件失效。</p>}
        <Summary lines={conclusion.summary} byId={byId} />
        <h3>仍不确定</h3>
        {conclusion.missing.length ? (
          <ul className="missing">
            {conclusion.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">规则未发现缺失项；这不代表事件已最终落定。</p>
        )}
        <p className="provenance">
          首次来源：
          {earliest
            ? `${earliest.sourceName}《${earliest.documentTitle}》，披露于 ${formatTime(earliest.publishedAt, earliest.publishedPrecision ?? "datetime")}${earliest.chainBroken ? "（来源链断裂，无法确认最初出处）" : "（已收录资料中最早可追溯的一条）"}`
            : "暂无"}
        </p>
      </section>

      {conclusion.conflicts.length > 0 && (
        <section aria-labelledby="conflict-h">
          <h2 id="conflict-h">证据冲突</h2>
          {conclusion.conflicts.map((c) => (
            <Conflict key={c.targetClaimId} card={c} byId={byId} target={byClaim.get(c.targetClaimId)} />
          ))}
        </section>
      )}

      <section aria-labelledby="ins-h">
        <h2 id="ins-h">关联标的</h2>
        <ul className="instruments">
          {d.instruments.map((i) => (
            <li key={i.code}>
              <strong>{i.name}</strong> <code>{i.code}</code>
              <span className={`tag tag-${i.link}`}>{i.link === "direct" ? "直接关联" : "间接关联"}</span>
              <p>
                {i.reason}
                {i.claim_id && byClaim.get(i.claim_id) ? `（依据：${byClaim.get(i.claim_id)!.sourceName}）` : "（无公告依据）"}
              </p>
            </li>
          ))}
        </ul>
        <MarketBackground instruments={d.instruments.map((i) => ({ code: i.code, name: i.name }))} />
      </section>

      <section aria-labelledby="tl-h">
        <div className="section-head">
          <h2 id="tl-h">证据时间线</h2>
          <nav className="seg" aria-label="时间轴">
            <Link href={q({ axis: "published" })} aria-current={axis === "published" ? "true" : undefined}>
              按披露时间
            </Link>
            <Link href={q({ axis: "occurred" })} aria-current={axis === "occurred" ? "true" : undefined}>
              按发生时间
            </Link>
          </nav>
        </div>
        {visible.length === 0 ? (
          <p className="empty">该时点尚无已抓取的证据。</p>
        ) : (
          <ol className="timeline">
            {known.map((e) => (
              <Node key={e.id} e={e} axis={axis} status={status(e)} byClaim={byClaim} live={!d.isHistorical} />
            ))}
          </ol>
        )}
        {unknown.length > 0 && (
          <>
            <h3 className="unknown-h">{axis === "occurred" ? "发生时间未知" : "披露时间未知"}（不用抓取时间填充）</h3>
            <ol className="timeline timeline-unknown">
              {unknown.map((e) => (
                <Node key={e.id} e={e} axis={axis} status={status(e)} byClaim={byClaim} live={!d.isHistorical} />
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="hist-h">
        <h2 id="hist-h">结论历史</h2>
        {d.history.length === 0 ? (
          <p className="empty">尚无结论版本。</p>
        ) : (
          <ol className="history">
            {[...d.history].reverse().map((h, i) => (
              <li key={h.id}>
                <div className="history-top">
                  <StatusBadge status={h.status} />
                  <time dateTime={h.generated_at}>{formatTime(h.generated_at)}</time>
                  {i === 0 && !d.isHistorical && <span className="tag">当前</span>}
                  <Link href={q({ asOf: toBeijingInput(h.generated_at) })}>回看此时</Link>
                </div>
                <p>{h.change_reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

function Summary({ lines, byId }: { lines: SummaryLine[]; byId: Map<string, EvidenceRow> }) {
  if (!lines.length) return <p className="muted">暂无可用证据。</p>;
  return (
    <ul className="summary">
      {lines.map((l) => (
        <li key={l.text}>
          {l.text}
          <span className="cites">
            {l.evidenceIds.map((id) => (
              <a key={id} href={`#ev-${cssId(id)}`} title={byId.get(id)?.documentTitle}>
                [{byId.get(id)?.sourceName ?? "证据"}]
              </a>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Conflict({ card, byId, target }: { card: ConflictCard; byId: Map<string, EvidenceRow>; target?: EvidenceRow }) {
  const side = (ids: string[]) =>
    ids.map((id) => byId.get(id)!).filter(Boolean).map((e) => (
      <li key={e.id}>
        <blockquote>{e.quote}</blockquote>
        <p className="meta">
          {e.sourceName} · {TIER_LABEL[e.tier]} · 披露 {formatTime(e.publishedAt, e.publishedPrecision ?? "datetime")}
        </p>
      </li>
    ));
  return (
    <div className="conflict">
      <p className="conflict-target">争议论断：{target?.content ?? card.targetClaimId}</p>
      <div className="conflict-sides">
        <div>
          <h3>支持方</h3>
          <ul>{side(card.supportIds)}</ul>
        </div>
        <div>
          <h3>反对方</h3>
          <ul>{side(card.refuteIds)}</ul>
        </div>
      </div>
      <p className="hint">双方同时保留；来源等级只用于排序，不单凭等级判定哪方为真。</p>
    </div>
  );
}

const cssId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

function Node({ e, axis, status, byClaim, live }: { e: EvidenceRow; axis: string; status: string | null; byClaim: Map<string, EvidenceRow>; live: boolean }) {
  const primary = axis === "occurred" ? formatTime(e.occurredAt, e.occurredPrecision ?? "datetime") : formatTime(e.publishedAt, e.publishedPrecision ?? "datetime");
  const late = e.publishedAt && Date.parse(e.fetchedAt) - Date.parse(e.publishedAt) > 7 * 86400_000;
  return (
    <li id={`ev-${cssId(e.id)}`} className={`node cat-${e.category}${status ? " node-inactive" : ""}`}>
      <time className="node-time">{primary}</time>
      <details>
        <summary>
          <span className="cat">{CATEGORY_LABEL[e.category]}</span>
          <span className="rel">{RELATION_LABEL[e.relation]}{e.targetContent ? `：${e.targetContent}` : ""}</span>
          <span className="node-content">{e.content}</span>
          <span className="meta">
            {e.sourceName} · {TIER_LABEL[e.tier]}
            {status && <span className="tag tag-warn">{status}</span>}
            {late && <span className="tag tag-warn">补录：抓取晚于披露</span>}
          </span>
        </summary>
        <div className="node-body">
          <blockquote>
            {e.quote}
          </blockquote>
          <p className="meta">
            出自《{e.documentTitle}》第 {e.quoteStart + 1} 字起
            {e.url && (
              <>
                {" · "}
                <a href={e.url} rel="noopener noreferrer nofollow" target="_blank">原文链接</a>
              </>
            )}
            {e.isConstructed && " · 构造数据"}
          </p>
          <dl className="times">
            <dt>发生</dt>
            <dd>{formatTime(e.occurredAt, e.occurredPrecision ?? "datetime")}{e.occurredText ? `（原文：${e.occurredText}）` : ""}</dd>
            <dt>披露</dt>
            <dd>{formatTime(e.publishedAt, e.publishedPrecision ?? "datetime")}</dd>
            <dt>抓取</dt>
            <dd>{formatTime(e.fetchedAt)}</dd>
            <dt>来源更新</dt>
            <dd>{formatTime(e.sourceUpdatedAt)}</dd>
            {e.validUntil && (
              <>
                <dt>有效期至</dt>
                <dd>{formatTime(e.validUntil)}</dd>
              </>
            )}
            {(e.unit || e.basis) && (
              <>
                <dt>单位/口径</dt>
                <dd>{[e.unit, e.basis].filter(Boolean).join("，")}</dd>
              </>
            )}
          </dl>
          <p className="meta">关联理由：{e.reason}{e.chainBroken ? " · 来源链断裂" : e.rootDocumentId !== e.documentId ? " · 转载，沿来源链归并至最初来源，不重复计权" : ""}</p>
          {live && !e.revokedAt && <RevokeButton evidenceId={e.id} />}
        </div>
      </details>
    </li>
  );
}
