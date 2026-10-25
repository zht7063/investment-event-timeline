import Link from 'next/link';
import { Status, STATUS_LABEL } from '@/domain/types';
import { formatTime } from '@/domain/time';
import { formatDisclosure } from '@/domain/research';
import { RELATION_STATE_LABEL, ANALYSIS_STATE_LABEL } from '@/domain/library';
import { StatusBadge } from '@/components/StatusBadge';
import { libraryEvents, libraryMaterials, queryFromParams } from '@/server/library';
import { ensureSeeded } from '@/server/seed';
import { LibraryWatchlist } from './LibraryWatchlist';
export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: PageProps<'/events'>) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['q','status','origin','codes','watched','offset','tab']) if (typeof sp[key] === 'string') params.set(key,sp[key]);
  const parsed = (()=>{try{return {query:queryFromParams(params),error:false};}catch{return {query:queryFromParams(new URLSearchParams()),error:true};}})();
  const q = {...parsed.query, limit:20};
  const tab = sp.tab === 'materials' ? 'materials' : 'events';
  const db = ensureSeeded();
  const events = libraryEvents(q,db), materials = libraryMaterials(q,db);
  const result = tab === 'events' ? events : materials;
  const url = (changes: Record<string,string|null>) => {const p = new URLSearchParams(params);for(const [k,v] of Object.entries(changes))v===null?p.delete(k):p.set(k,v);return `/events?${p}`;};
  const returnTo = url({offset:String(result.offset)});
  const detailUrl = (href: string) => `${href}?returnTo=${encodeURIComponent(returnTo)}`;
  return <>
    <section className="hero"><h1>每个判断，都能追到原文。</h1><p className="lede">资料收录后即可查询，自动提取的事项逐步进入事件库。自动分析与人工确认分别标注，研究尚未完成也保留已有结果。</p></section>
    {parsed.error && <p role="alert">筛选参数无效，已显示默认结果。请重新选择筛选条件。</p>}
    <nav className="research-actions library-tabs" aria-label="事件库视图">
      <Link href={url({tab:'events',offset:null})} aria-current={tab==='events'?'page':undefined}>事件（{events.total}）</Link>
      <Link href={url({tab:'materials',offset:null})} aria-current={tab==='materials'?'page':undefined}>资料（{materials.total}）</Link>
    </nav>
    <form className="filters library-filters" role="search" method="get">
      <input type="hidden" name="tab" value={tab}/>
      {q.watched && <input type="hidden" name="watched" value="1"/>}{q.codes.length>0 && <input type="hidden" name="codes" value={q.codes.join(',')}/>}
      <label><span>搜索</span><input name="q" defaultValue={q.q} placeholder="事件、资料、公司或代码" maxLength={50}/></label>
      {tab==='events' ? <label><span>结论状态</span><select name="status" defaultValue={q.status ?? ''}><option value="">全部</option>{Status.options.map(s=><option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label> : q.status && <input type="hidden" name="status" value={q.status}/>}
      <label><span>来源类型</span><select name="origin" defaultValue={q.origin}><option value="all">全部</option><option value="automatic">自动研究</option><option value="manual">人工事件／导入与同步</option></select></label>
      <button type="submit">筛选</button><Link href={`/events?tab=${tab}`}>清除条件</Link>
    </form>
    {tab==='materials' && <p className="hint">资料不受事件结论状态筛选影响；未分析、失败及未生成事项的资料均保留。</p>}
    <p><Link href="/research">输入股票代码与日期，开始自动研究 →</Link></p>
    <LibraryWatchlist/>
    <section aria-live="polite"><p className="count">共 {result.total} {tab==='events'?'个事件':'份资料'}，当前 {result.total?result.offset+1:0}–{Math.min(result.total,result.offset+result.limit)}</p>
      {result.total===0 && <p className="empty">{q.watched?'当前关注标的没有符合条件的结果。可添加代码或关闭“只看关注标的”。':'没有符合搜索或状态条件的'+(tab==='events'?'事件。可切换“资料”查看已收录内容。':'资料。')}</p>}
      {tab==='events' ? <ol className="event-list">{events.items.map(e=><li key={`${e.origin}:${e.id}`}><Link href={detailUrl(e.href)} className="event-card">
        <div className="event-card-top"><StatusBadge status={e.status}/><span className="tag">{e.origin==='automatic'?'自动提取 · 未经人工确认':'人工事件'}</span>{e.relationStatus && <span className="tag">{RELATION_STATE_LABEL[e.relationStatus]}</span>}{e.is_constructed===1 && <span className="tag">构造数据</span>}</div>
        <h3>{e.title}</h3><p className="meta">{e.name} {e.instruments} · {e.evidence_count} 条证据 · 更新 {formatTime(e.generated_at)}</p>
        {e.origin==='automatic' && <p className="hint">当前展示研究区间：{e.start_day} 至 {e.end_day}；其他研究可在详情切换。</p>}
      </Link></li>)}</ol> : materials.items.map(m=><details className="research-document" key={m.id}>
        <summary><span>{m.title}</span>{m.is_constructed===1 && <span className="tag">构造数据</span>}<span className="research-document-meta">披露 {formatDisclosure(m.published_at)} · {m.publisher} · {m.content_kind==='snippet'?'片段':m.content_kind==='text'?'正文':'摘要'}</span><span className="research-document-meta">{m.stocks.map(s=>`${s.name} ${s.code}：${ANALYSIS_STATE_LABEL[s.status] ?? s.status}`).join('；')}</span></summary>
        <p className="research-body">{m.body}</p><p className="hint">抓取时间 {formatTime(m.fetched_at)}</p>
        {m.stocks.map(s=><p className="hint" key={s.code}>{s.name} {s.code}：{s.reason}</p>)}
        {m.url && /^https?:\/\//i.test(m.url) && <a href={m.url} target="_blank" rel="noopener noreferrer nofollow">打开来源页面 ↗</a>}
        <h3>关联事项</h3>{m.events.length ? <ul>{m.events.map(e=><li key={e.id}><Link href={detailUrl(e.href)}>{e.title}</Link></li>)}</ul> : <p className="hint">尚无关联事项，资料已保存。</p>}
        {m.research.length>0 && <><h3>相关研究</h3><ul>{m.research.map(r=><li key={r.jobId}><Link href={`/research/${r.jobId}`}>{r.code} · {r.start} 至 {r.end}</Link> · {ANALYSIS_STATE_LABEL[r.status]}{r.error && <span className="field-error"> · {r.error}</span>}</li>)}</ul></>}
      </details>)}
    </section>
    {result.total>20 && <nav className="research-actions" aria-label="事件库分页">{result.offset>0 && <Link href={url({offset:String(Math.max(0,result.offset-20))})}>上一页</Link>}<span>第 {Math.floor(result.offset/20)+1} / {Math.ceil(result.total/20)} 页</span>{result.offset+20<result.total && <Link href={url({offset:String(result.offset+20)})}>下一页</Link>}</nav>}
  </>;
}
