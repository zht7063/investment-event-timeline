import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Status, type Status as StatusType } from '@/domain/types';
import { getDb } from './db';
import { recompute } from './repo';
import { relationState, type ReportEvent } from './research/report';
import type { Analysis } from './research/analysis';

export const LibraryQuery = z.object({
  q: z.string().max(50).default(''),
  status: Status.optional(),
  origin: z.enum(['all', 'manual', 'automatic']).default('all'),
  codes: z.array(z.string().max(32)).max(50).default([]),
  watched: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
});
export type LibraryFilter = z.input<typeof LibraryQuery>;
export function queryFromParams(p: URLSearchParams) {
  return LibraryQuery.parse({ q: p.get('q') || '', status: p.get('status') || undefined,
    origin: p.get('origin') || 'all', codes: p.get('codes')?.split(',').filter(Boolean) ?? [], watched: p.get('watched') === '1',
    limit: p.has('limit') ? Number(p.get('limit')) : 20, offset: p.has('offset') ? Number(p.get('offset')) : 0 });
}
function pageBounds(total: number, limit: number, offset: number) {
  return { total, limit, offset: Math.min(offset, Math.max(0, Math.ceil(total / limit) - 1) * limit) };
}
export type LibraryEvent = {
  id: string; title: string; subject_code: string; instruments: string; name: string | null;
  status: StatusType | null; generated_at: string | null; latest_fetched_at: string | null;
  evidence_count: number; is_constructed: number; origin: 'manual' | 'automatic';
  reviewState: 'automatic' | 'manual'; relationStatus: string | null; href: string;
  job_id: string | null; start_day: string | null; end_day: string | null;
};
const eventCTE = `with ranked as (
 select r.*,e.code,j.name,j.start_day,j.end_day,
 row_number() over(partition by r.event_id order by r.updated_at desc,r.report_revision desc,r.job_id desc) as rank
 from library_event_research r join library_events e on e.id=r.event_id join research_jobs j on j.id=r.job_id
), combined as (
 select e.id,e.title,e.subject_code,
 coalesce((select group_concat(code) from event_instruments i where i.event_id=e.id),e.subject_code) as instruments,
 (select group_concat(name) from event_instruments i where i.event_id=e.id) as name,
 c.status,c.generated_at,
 (select max(v.fetched_at) from event_evidence ee join claims cl on cl.id=ee.claim_id join document_versions v on v.id=cl.version_id where ee.event_id=e.id and ee.revoked_at is null) as latest_fetched_at,
 (select count(*) from event_evidence ee where ee.event_id=e.id and ee.revoked_at is null) as evidence_count,
 e.is_constructed,'manual' as origin,null as snapshot,null as job_id,null as start_day,null as end_day
 from events e left join conclusions c on c.id=e.current_conclusion_id
 union all
 select event_id,title,code,code,name,
 case when json_extract(snapshot,'$.relationStatus')='done' then json_extract(snapshot,'$.conclusion.status') else 'unverified' end,
 updated_at,(select max(m.fetched_at) from library_event_materials em join research_materials m on m.id=em.material_id where em.event_id=ranked.event_id and em.job_id=ranked.job_id),
 json_array_length(snapshot,'$.evidence'),0,'automatic',snapshot,job_id,start_day,end_day from ranked where rank=1
)`;
export function libraryEvents(raw: LibraryFilter = {}, db = getDb()) {
  const q = LibraryQuery.parse(raw);
  // Preserve the existing time-dependent expiry behavior for manually reviewed events.
  for (const row of db.prepare('select id from events').all()) recompute(String(row.id), new Date().toISOString(), db);
  const where = ['1=1'], args: (string | number)[] = [];
  if (q.q) { where.push('(title like ? or subject_code like ? or name like ? or instruments like ?)'); args.push(...Array(4).fill(`%${q.q}%`)); }
  if (q.origin !== 'all') { where.push('origin=?'); args.push(q.origin); }
  if (q.status) { where.push('status=?'); args.push(q.status); }
  if (q.codes.length) { where.push(`(${q.codes.map(() => "instr(','||instruments||',',','||?||',')>0").join(' or ')})`); args.push(...q.codes); }
  else if (q.watched) where.push('0=1');
  const sql = `${eventCTE} select * from combined where ${where.join(' and ')}`;
  const total = Number(db.prepare(`select count(*) as n from (${sql})`).get(...args)!.n);
  const page = pageBounds(total,q.limit,q.offset);
  const rows = db.prepare(`${sql} order by generated_at desc,id limit ? offset ?`).all(...args,page.limit,page.offset);
  const items = rows.map(row => {
    const { snapshot, ...rest } = row;
    const automatic = row.origin === 'automatic';
    const state = automatic ? relationState(String(row.job_id),JSON.parse(String(snapshot)),db) : null;
    return { ...rest, status: automatic && state !== 'done' ? 'unverified' : rest.status, relationStatus: state, reviewState: automatic ? 'automatic' : 'manual',
      href: automatic ? `/events/automatic/${row.id}` : `/events/${row.id}` } as LibraryEvent;
  });
  return { ...page, items };
}
export function libraryEventDetail(id: string, jobId?: string, db = getDb()) {
  const rows = db.prepare(`select r.*,e.code,j.name,j.start_day,j.end_day,j.status as job_status from library_event_research r
    join library_events e on e.id=r.event_id join research_jobs j on j.id=r.job_id where r.event_id=? order by r.updated_at desc,r.report_revision desc,r.job_id desc`).all(id);
  if (!rows.length || (jobId && !rows.some(r => r.job_id === jobId))) return null;
  const selected = rows.find(r => r.job_id === jobId) ?? rows[0];
  const event = JSON.parse(String(selected.snapshot)) as ReportEvent;
  event.relationStatus = relationState(String(selected.job_id), event, db);
  if (event.relationStatus !== 'done') {
    event.conclusion = { ...event.conclusion, status: 'unverified', summary: [], conflicts: [], missing: ['证据关系尚未核验完成，以下为自动提取的原文摘录。'] };
  }
  return { id, origin: 'automatic' as const, reviewState: 'automatic' as const, event,
    selected: { jobId: String(selected.job_id), code: String(selected.code), name: selected.name as string | null,
      start: String(selected.start_day), end: String(selected.end_day), revision: Number(selected.report_revision), updatedAt: String(selected.updated_at) },
    research: rows.map(r => ({ jobId: String(r.job_id), start: String(r.start_day), end: String(r.end_day), updatedAt: String(r.updated_at), status: String(r.job_status) })) };
}
const materialCTE = `with material as (
 select id,title,body,url,publisher,published_at,fetched_at,content_kind,'automatic' as origin,0 as is_constructed from research_materials
 union all
 select 'manual:'||v.id,d.title,v.body,d.url,s.name,v.published_at,v.fetched_at,'text','manual',d.is_constructed
 from document_versions v join documents d on d.id=v.document_id join sources s on s.id=d.source_id
), associations as (
 select d.material_id as id,j.code,j.name from research_documents d join research_jobs j on j.id=d.job_id
 union
 select 'manual:'||v.id,coalesce(c.subject_code,v.subject_hint,''),coalesce(i.name,'')
 from document_versions v left join claims c on c.version_id=v.id left join event_instruments i on i.claim_id=c.id
)`;
export function libraryMaterials(raw: LibraryFilter = {}, db = getDb()) {
  const q = LibraryQuery.parse(raw);
  const where = ['1=1'], args: (string | number)[] = [];
  if (q.q) { where.push('(m.title like ? or exists(select 1 from associations a where a.id=m.id and (a.code like ? or a.name like ?)))'); args.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.origin !== 'all') { where.push('m.origin=?'); args.push(q.origin); }
  if (q.codes.length) { where.push(`exists(select 1 from associations a where a.id=m.id and a.code in (${q.codes.map(() => '?').join(',')}))`); args.push(...q.codes); }
  else if (q.watched) where.push('0=1');
  const sql = `${materialCTE} select m.* from material m where ${where.join(' and ')}`;
  const total = Number(db.prepare(`select count(*) as n from (${sql})`).get(...args)!.n);
  const page = pageBounds(total,q.limit,q.offset);
  const items = db.prepare(`${sql} order by fetched_at desc,id limit ? offset ?`).all(...args,page.limit,page.offset).map(row => {
    const research = row.origin === 'automatic' ? db.prepare(`select j.id as jobId,j.code,j.name,j.start_day as start,j.end_day as end,j.status as jobStatus,d.analysis_status as status,d.range_status,d.analysis,d.error
      from research_documents d join research_jobs j on j.id=d.job_id where d.material_id=? order by (d.analysis_status='done') desc,j.updated_at desc,j.id`).all(row.id!) : [];
    const byCode = new Map<string, { code: string; name: string; status: string; reason: string }>();
    for (const r of research) {
      if (byCode.has(String(r.code))) continue;
      const a = r.analysis ? JSON.parse(String(r.analysis)) as Analysis : null;
      const reason = r.status === 'excluded' ? '日期不明，未纳入区间结论' : r.status === 'failed' ? String(r.error || '分析失败，可在研究记录重试') : r.status === 'pending' ? '等待分析，资料已保存'
        : a?.relevance === 'irrelevant' ? '与该股票无关，未生成事项' : a?.relevance === 'uncertain' ? '股票关联不明，未生成事项' : !a?.events.length ? '未提取到可验证事项' : '已提取事项；自动分析未经人工确认';
      byCode.set(String(r.code), { code: String(r.code), name: String(r.name ?? ''), status: String(r.status), reason });
    }
    if (row.origin === 'manual') {
      const legacy = db.prepare(`select v.analysis_status,v.subject_hint,v.analysis_error from document_versions v where v.id=?`).get(String(row.id).slice(7))!;
      byCode.set(String(legacy.subject_hint ?? ''), { code: String(legacy.subject_hint ?? ''), name: '', status: String(legacy.analysis_status), reason: String(legacy.analysis_error ?? '人工导入／来源同步资料') });
    }
    const events = row.origin === 'automatic' ? db.prepare(`select distinct e.event_id as id,r.title from library_event_materials e join library_event_research r on r.event_id=e.event_id and r.job_id=e.job_id where e.material_id=? group by e.event_id`).all(row.id!).map(e => ({ id: String(e.id), title: String(e.title), href: `/events/automatic/${e.id}` }))
      : db.prepare(`select distinct e.id,e.title from events e join event_evidence ee on ee.event_id=e.id join claims c on c.id=ee.claim_id where c.version_id=? and ee.revoked_at is null`).all(String(row.id).slice(7)).map(e=>({id:String(e.id),title:String(e.title),href:`/events/${e.id}`}));
    return { id: String(row.id), title: String(row.title), body: String(row.body), url: row.url as string | null, publisher: String(row.publisher),
      published_at: row.published_at as string | null, fetched_at: String(row.fetched_at), content_kind: String(row.content_kind), origin: String(row.origin), is_constructed: Number(row.is_constructed),
      stocks: [...byCode.values()], events, research: research.map(r => ({ jobId: String(r.jobId), code: String(r.code), start: String(r.start), end: String(r.end), status: String(r.status), error: r.error as string | null })) };
  });
  return { ...page, items };
}
