import Link from 'next/link';
import { notFound } from 'next/navigation';
import { libraryEventDetail } from '@/server/library';
import { safeLibraryReturn, RELATION_STATE_LABEL } from '@/domain/library';
import { formatTime } from '@/domain/time';
import { CATEGORY_LABEL, RELATION_LABEL } from '@/domain/types';
import { StatusBadge } from '@/components/StatusBadge';
export const dynamic = 'force-dynamic';
export default async function AutomaticEvent({params,searchParams}: {params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {id}=await params, sp=await searchParams;
  const d=libraryEventDetail(id,typeof sp.job==='string'?sp.job:undefined);
  if(!d)notFound();
  const back=safeLibraryReturn(sp.returnTo), event=d.event;
  return <article className="detail">
    <p><Link href={back}>返回事件库</Link></p>
    <section className="hero hero-small"><h1>{event.title}</h1><p className="lede">{d.selected.name} {d.selected.code} · 自动提取，未经人工确认</p></section>
    <form className="filters library-filters" method="get"><input type="hidden" name="returnTo" value={back}/><label><span>研究区间与记录</span><select name="job" defaultValue={d.selected.jobId}>{d.research.map(r=><option key={r.jobId} value={r.jobId}>{r.start} 至 {r.end} · 更新 {formatTime(r.updatedAt)} · {r.jobId.slice(0,8)}</option>)}</select></label><button>切换研究</button></form>
    <p>当前展示 {d.selected.start} 至 {d.selected.end} 的研究结果。不同研究的证据与结论分别保留，不构成跨报告综合结论。</p>
    <p><Link href={`/research/${d.selected.jobId}`}>查看本次研究与来源覆盖</Link>{' · '}<Link href={`/events?tab=materials&q=${encodeURIComponent(d.selected.code)}`}>查看该股票全部资料</Link></p>
    <section className="research-progress"><div className="research-actions"><StatusBadge status={event.relationStatus==='done'?event.conclusion.status:'unverified'}/><span>{RELATION_STATE_LABEL[event.relationStatus]}</span></div>
      <p className="hint">基于已收录片段或摘要的自动分析，不代表全文核验或人工确认。</p>
      {event.relationStatus==='done' ? <ul>{event.conclusion.summary.map((s,i)=><li key={i}>{s.text}</li>)}</ul> : <p>证据关系尚未核验完成，以下保留初步提取的原文摘录。</p>}
      {event.relationStatus==='failed' && <p className="field-error">{event.relationError}。可在本次研究中重试。</p>}
      {event.warnings.map(w=><p className="hint" key={w}>{w}</p>)}
    </section>
    <section><h2>证据与时间线</h2><ol className="research-evidence">{[...event.evidence].sort((a,b)=>(a.publishedAt??'9999').localeCompare(b.publishedAt??'9999')||a.id.localeCompare(b.id)).map(e=><li key={e.id}>
      <p className="meta">披露 {formatTime(e.publishedAt,e.publishedPrecision)} · {e.sourceName} · {CATEGORY_LABEL[e.category]}{event.relationStatus==='done' && ` · ${RELATION_LABEL[e.relation]}`}</p>
      <blockquote>{e.quote}</blockquote><p className="hint">发生 {formatTime(e.occurredAt,e.occurredPrecision)} · 抓取 {formatTime(e.fetchedAt)} · {e.contentKind==='snippet'?'片段':'摘要'}</p>
      {event.relationStatus==='done' && <p className="hint">{e.reason}</p>}
      {e.url && /^https?:\/\//i.test(e.url) && <a href={e.url} target="_blank" rel="noopener noreferrer nofollow">打开来源页面 ↗</a>}
    </li>)}</ol></section>
  </article>;
}
