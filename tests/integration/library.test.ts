import { afterEach, expect, it } from 'vitest';
import { openDb, tx } from '@/server/db';
import { createResearch, saveMaterial, jobById, cancelResearch, retryResearch, researchStatus, claimJob, release, materials, hash, deleteResearch, owns } from '@/server/research/store';
import { writeReport, workOnce } from '@/server/research/worker';
import { groupAnalyses, groupFingerprint, type Analysis } from '@/server/research/analysis';
import { backfillLibrary } from '@/server/research/library-index';
import { libraryEvents, libraryMaterials, libraryEventDetail, queryFromParams } from '@/server/library';
import { relationState } from '@/server/research/report';
const databases: ReturnType<typeof openDb>[]=[];
const db=()=>{const d=openDb(':memory:');databases.push(d);return d;};
afterEach(()=>{databases.forEach(d=>d.close());databases.length=0;});
const input={code:'002230.SZ',start:'2026-09-01',end:'2026-09-07'};
function job(d:ReturnType<typeof db>,key:string,code=input.code){const j=createResearch({...input,code},key,d);d.prepare('update research_jobs set name=? where id=?').run('科大讯飞',j.id);return jobById(j.id,d)!;}
function add(d:ReturnType<typeof db>,jobId:string,n:number,done=true,anchored=false,events=2){
 const body=`科大讯飞2026年三季度报告披露事项${n}。`;
 const id=saveMaterial(jobId,{key:`item-${n}`,title:`科大讯飞报告${n}`,body,publishedAt:'2026-09-02',publisher:'测试来源',sourceId:'ifind-notice',contentKind:'snippet',url:null},'inside',d);
 if(done){const analysis:Analysis={relevance:'direct',relevanceQuote:body,reason:'目标公司',warnings:[],events:Array.from({length:events},(_,i)=>({title:`事项${n}-${i}`,type:'earnings',objectAnchor:anchored?'三季度报告':null,periodAnchor:anchored?'2026年':null,claims:[{quote:body,category:'fact',occurredAt:null,validUntil:null,unit:null,basis:null}]}))};d.prepare("update research_documents set analysis_status='done',analysis=? where job_id=? and material_id=?").run(JSON.stringify(analysis),jobId,id);}
 return id;
}
it('81 collected, 11 analyzed, 22 events are searchable before completion; cancellation/retry do not remove them',()=>{
 const d=db(),j=job(d,'partial');for(let n=0;n<81;n++)add(d,j.id,n,n<11);
 tx(d,()=>writeReport(j,d));
 expect(libraryMaterials({q:'002230.SZ'},d)).toMatchObject({total:81,limit:20});
 expect(libraryEvents({q:'科大讯飞'},d).total).toBe(22);
 expect(libraryEvents({q:'002230',status:'supported'},d).total).toBe(0);
 expect(libraryEvents({q:'002230',status:'unverified'},d).total).toBe(22);
 expect(libraryEvents({q:'002230',origin:'manual'},d).total).toBe(0);
 expect(libraryMaterials({q:'002230',offset:9999},d)).toMatchObject({offset:80,items:expect.any(Array)});
 expect(libraryEvents({watched:true},d).total).toBe(0);
 expect(libraryEvents({codes:['002230.SZ'],watched:true},d).total).toBe(22);
 cancelResearch(j.id,d);retryResearch(j.id,d);expect(libraryEvents({},d).total).toBe(22);expect(libraryMaterials({},d).total).toBe(81);
});
it('backfill is idempotent, dry run does not write, reports and manual events are unchanged',()=>{
 const d=db(),j=job(d,'old');add(d,j.id,1);
 d.prepare("insert into events(id,title,event_type,subject_code,matter_key) values('manual','人工事项','earnings','002230.SZ','manual')").run();
 d.prepare('insert into research_reports(job_id,revision,generated_at,body) values(?,7,?,?)').run(j.id,j.updated_at,'{"events":[]}');
 const before=JSON.stringify(d.prepare('select * from research_reports').all());
 expect(backfillLibrary(d,true)).toMatchObject({associations:2,failures:[]});expect(libraryEvents({origin:'automatic'},d).total).toBe(0);
 for(let i=0;i<2;i++)expect(backfillLibrary(d)).toMatchObject({associations:2,failures:[]});
 expect(libraryEvents({origin:'automatic'},d).total).toBe(2);
 expect(JSON.stringify(d.prepare('select * from research_reports').all())).toBe(before);
 expect(d.prepare("select title from events where id='manual'").get()?.title).toBe('人工事项');
});
it('deduplicates anchored events across jobs but retains separate snapshots and successful stock analysis',()=>{
 const d=db(),a=job(d,'a'),b=job(d,'b');const material=add(d,a.id,1,true,true,1);add(d,b.id,1,false);add(d,b.id,2,true,true,1);
 tx(d,()=>writeReport(a,d));tx(d,()=>writeReport(b,d));
 const list=libraryEvents({},d);expect(list.total).toBe(1);
 const detail=libraryEventDetail(list.items[0].id,a.id,d)!;
 expect(detail.event.evidence).toHaveLength(1);expect(detail.research).toHaveLength(2);expect(detail.event.conclusion.status).toBe('unverified');
 const m=libraryMaterials({},d).items.find(m=>m.id===material)!;expect(m.research).toHaveLength(2);expect(m.stocks[0].status).toBe('done');
 expect(libraryMaterials({},d).total).toBe(2);
 expect(libraryEventDetail(list.items[0].id,'wrong',d)).toBeNull();
});
it('unanchored keys include stock and different periods remain separate',()=>{
 const d=db(),a=job(d,'a'),b=job(d,'b','600519.SH');add(d,a.id,1);add(d,b.id,1);
 tx(d,()=>writeReport(a,d));tx(d,()=>writeReport(b,d));expect(libraryEvents({},d).total).toBe(4);
 const c=job(d,'c');add(d,c.id,2,true,true,1);const e=job(d,'e');const id=add(d,e.id,3,true,true,1);
 const row=d.prepare('select analysis from research_documents where job_id=? and material_id=?').get(e.id,id)!;
 const parsed=JSON.parse(String(row.analysis));parsed.events[0].periodAnchor='2025年';d.prepare('update research_documents set analysis=? where job_id=? and material_id=?').run(JSON.stringify(parsed),e.id,id);
 tx(d,()=>writeReport(c,d));tx(d,()=>writeReport(e,d));expect(libraryEvents({},d).total).toBe(6);
});
it('relation running requires a live matching lease; evidence changes invalidate results; legacy keys remain readable',()=>{
 const d=db(),j=job(d,'lease');add(d,j.id,1);const owned=claimJob(d)!;const group=groupAnalyses(materials(j.id,d),j.code)[0];
 d.prepare("insert into research_relations(job_id,group_id,fingerprint,status) values(?,?,?,'running')").run(j.id,group.id,groupFingerprint(group));
 d.prepare('insert into research_relation_leases values(?,?,?)').run(j.id,group.id,owned.lease_token);
 tx(d,()=>writeReport(owned,d));expect(researchStatus(j.id,d)!.report!.body.events[0].relationStatus).toBe('running');
 release(owned,d);expect(researchStatus(j.id,d)!.report!.body.events[0].relationStatus).toBe('pending');
 const legacy=hash(group.evidence[0].id.split(':').slice(0,2).join('|'));
 d.prepare("update research_relations set group_id=?,status='done',result=? where job_id=? and group_id=?").run(legacy,'{"links":[]}',j.id,group.id);
 expect(relationState(j.id,group,d)).toBe('done');
 const changed={...group,evidence:[...group.evidence,{...group.evidence[0],id:'new'}]};expect(relationState(j.id,changed,d)).toBe('pending');
});
it('worker publishes inside the analysis transaction and reports actual relation execution',async()=>{
 const d=db(),j=job(d,'worker');add(d,j.id,1,true,true,1);d.prepare("update research_source_runs set status='exhausted' where job_id=?").run(j.id);
 let seen=false;
 await workOnce(d,{reconcile:async()=>{const state=researchStatus(j.id,d)!;expect(state.report!.body.events[0].relationStatus).toBe('running');seen=true;return {links:[]};}});
 expect(seen).toBe(true);expect(libraryEvents({},d).items[0].relationStatus).toBe('done');
 const pending=job(d,'pending');const id=add(d,pending.id,10,false);d.prepare("update research_jobs set status='cancelled' where id=?").run(j.id);d.prepare("update research_jobs set phase='analyze' where id=?").run(pending.id);
 const analysis:Analysis={relevance:'direct',relevanceQuote:'x',reason:'test',warnings:[],events:[{title:'新增事项',type:'other',objectAnchor:null,periodAnchor:null,claims:[{quote:'x',category:'fact',occurredAt:null,validUntil:null,unit:null,basis:null}]}]};
 await workOnce(d,{extract:async()=>analysis});expect(d.prepare('select analysis_status from research_documents where material_id=?').get(id)?.analysis_status).toBe('done');expect(libraryEvents({},d).total).toBe(2);
});
it('unknown dates, failure, irrelevant and no-event analyses remain in materials with reasons',()=>{
 const d=db(),j=job(d,'reasons');for(let n=0;n<5;n++)add(d,j.id,n);
 const rows=d.prepare('select material_id,analysis from research_documents where job_id=? order by material_id').all(j.id);
 d.prepare("update research_documents set range_status='unknown',analysis_status='excluded' where material_id=?").run(rows[0].material_id!);
 d.prepare("update research_documents set analysis_status='failed',error='test failure' where material_id=?").run(rows[1].material_id!);
 for(const [i,relevance] of [[2,'irrelevant'],[3,'uncertain'],[4,'direct']] as const){const a=JSON.parse(String(rows[i].analysis));a.relevance=relevance;a.events=[];d.prepare('update research_documents set analysis=? where material_id=?').run(JSON.stringify(a),rows[i].material_id!);}
 backfillLibrary(d);expect(libraryEvents({},d).total).toBe(0);expect(libraryMaterials({},d).total).toBe(5);
 expect(libraryMaterials({},d).items.map(m=>m.stocks[0].reason).join(' ')).toContain('未提取到可验证事项');
});
it('rejects invalid pagination and query filters',()=>{
 for(const query of ['offset=-1','offset=Infinity','limit=NaN','status=unknown','origin=wrong'])expect(()=>queryFromParams(new URLSearchParams(query))).toThrow();
});

it('failed index writes cannot leave analysis committed without its event',async()=>{
 const d=db(),j=job(d,'atomic');const id=add(d,j.id,88,false);d.prepare("update research_jobs set phase='analyze' where id=?").run(j.id);
 d.exec("create trigger reject_library before insert on library_events begin select raise(abort, 'index unavailable'); end;");
 const a:Analysis={relevance:'direct',relevanceQuote:'x',reason:'test',warnings:[],events:[{title:'atomic',type:'other',objectAnchor:null,periodAnchor:null,claims:[{quote:'x',category:'fact',occurredAt:null,validUntil:null,unit:null,basis:null}]}]};
 await workOnce(d,{extract:async()=>a});
 expect(d.prepare('select analysis_status from research_documents where material_id=?').get(id)?.analysis_status).toBe('failed');
 expect(d.prepare('select count(*) as n from research_reports').get()?.n).toBe(0);
 expect(d.prepare('select count(*) as n from research_analysis_cache').get()?.n).toBe(0);
});

it('batch deletion removes exclusive events and materials but preserves shared and manual data',()=>{
 const d=db(),a=job(d,'delete-a'),b=job(d,'keep-b');
 const shared=add(d,a.id,1,true,true,1);add(d,b.id,1,true,true,1);
 const exclusive=add(d,a.id,2,true,false,1);
 tx(d,()=>writeReport(a,d));tx(d,()=>writeReport(b,d));
 d.prepare("insert into events(id,title,event_type,subject_code,matter_key) values('manual-keep','人工事项','other','002230.SZ','manual')").run();
 d.prepare('insert into research_analysis_cache values(?,?,?,?)').run(exclusive,a.code,'v1','{}');
 const lease=claimJob(d)!;
 const result=deleteResearch([a.id,a.id,'missing'],d);
 expect(result).toEqual({deleted:1,deletedIds:[a.id]});expect(owns(lease,d)).toBe(false);
 expect(jobById(a.id,d)).toBeUndefined();expect(jobById(b.id,d)).toBeDefined();
 expect(d.prepare('select id from research_materials where id=?').get(exclusive)).toBeUndefined();
 expect(d.prepare('select id from research_materials where id=?').get(shared)).toBeDefined();
 expect(d.prepare('select count(*) as n from research_analysis_cache').get()?.n).toBe(0);
 expect(libraryEvents({origin:'automatic'},d).total).toBe(1);
 const id=libraryEvents({origin:'automatic'},d).items[0].id;
 expect(libraryEventDetail(id,undefined,d)!.research.map(r=>r.jobId)).toEqual([b.id]);
 expect(d.prepare("select id from events where id='manual-keep'").get()).toBeDefined();
 deleteResearch([b.id],d);expect(libraryEvents({origin:'automatic'},d).total).toBe(0);expect(libraryMaterials({origin:'automatic'},d).total).toBe(0);
 expect(deleteResearch([a.id,b.id],d).deleted).toBe(0);expect(d.prepare('pragma foreign_key_check').all()).toEqual([]);
 expect(backfillLibrary(d).associations).toBe(0);
});
it('deleting a running analysis fences its late result',async()=>{
 const d=db(),j=job(d,'inflight');add(d,j.id,99,false);d.prepare("update research_jobs set phase='analyze' where id=?").run(j.id);
 await workOnce(d,{extract:async()=>{deleteResearch([j.id],d);return {relevance:'irrelevant',relevanceQuote:'',reason:'test',events:[],warnings:[]};}});
 expect(jobById(j.id,d)).toBeUndefined();expect(libraryEvents({},d).total).toBe(0);expect(libraryMaterials({},d).total).toBe(0);
});
it('batch deletion rolls back all records if a later delete fails',()=>{
 const d=db(),a=job(d,'rollback-a'),b=job(d,'rollback-b');add(d,a.id,1);add(d,b.id,2);tx(d,()=>writeReport(a,d));tx(d,()=>writeReport(b,d));
 d.exec(`create trigger block_delete before delete on research_jobs when old.id='${b.id}' begin select raise(abort,'test'); end;`);
 expect(()=>deleteResearch([a.id,b.id],d)).toThrow();expect(jobById(a.id,d)).toBeDefined();expect(libraryEvents({},d).total).toBe(4);expect(libraryMaterials({},d).total).toBe(2);
});
