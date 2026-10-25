import { getDb, tx } from '../../src/server/db';
import { ensureSeeded } from '../../src/server/seed';
import { createResearch, saveMaterial, jobById } from '../../src/server/research/store';
import { writeReport } from '../../src/server/research/worker';
import type { Analysis } from '../../src/server/research/analysis';
const db=ensureSeeded(getDb());
const j=createResearch({code:'002230.SZ',start:'2026-09-01',end:'2026-09-07'},'library-e2e',db);
db.prepare("update research_jobs set name='科大讯飞',status='running',phase='analyze',lease_token='fixture-hold',lease_until='2999-01-01T00:00:00.000Z' where id=?").run(j.id);
for(let n=0;n<81;n++){
 const body=`构造验收资料：科大讯飞2026年三季度披露事项${n}。`;
 const id=saveMaterial(j.id,{key:`library-${n}`,title:`科大讯飞构造资料${n}`,body,publishedAt:n===80?null:'2026-09-02',publisher:'构造测试来源',sourceId:'ifind-notice',contentKind:'snippet',url:null},n===80?'unknown':'inside',db);
 if(n<11){const a:Analysis={relevance:'direct',relevanceQuote:body,reason:'目标公司',warnings:[],events:[0,1].map(i=>({title:`构造事项${n}-${i}`,type:'earnings',objectAnchor:null,periodAnchor:null,claims:[{quote:body,category:'fact',occurredAt:null,validUntil:null,unit:null,basis:null}]}))};db.prepare("update research_documents set analysis_status='done',analysis=? where job_id=? and material_id=?").run(JSON.stringify(a),j.id,id);}
}
tx(db,()=>writeReport(jobById(j.id,db)!,db));
db.close();
