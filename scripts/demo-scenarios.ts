/** Append-only constructed examples. No provider/model calls; never reset existing data. */
import { backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, tx } from '../src/server/db';
import { contentHash } from '../src/domain/matching';
import { replayHistory } from '../src/server/repo';
import { saveMaterial, jobById, materials } from '../src/server/research/store';
import { writeReport } from '../src/server/research/worker';
import { groupAnalyses, groupFingerprint, type Analysis } from '../src/server/research/analysis';

const db = getDb(), now = new Date().toISOString(), prefix = 'demo-scenarios-v1';
const dir = resolve(process.env.BACKUP_DIR || './data/backups');
mkdirSync(dir, { recursive: true });
const backupPath = resolve(dir, `before-demo-${now.replaceAll(':', '-')}.db`);
await backup(db, backupPath);
chmodSync(backupPath, 0o600);
console.log(JSON.stringify({ backup: backupPath }));
const id = (s: string) => `${prefix}-${s}`;
const cases = [
  {key:'unverified', title:'待核实｜收购传闻尚无公告',type:'acquisition', claims:[{text:'演示星河科技拟收购虚构晨星芯片，尚未获得公告证实。',category:'rumor',source:'rumor',relation:'supports'}]},
  {key:'supported',title:'有证据支持｜董事会通过分红方案',type:'dividend',claims:[{text:'演示星河科技董事会通过每10股派发现金红利2元的方案，尚待股东大会审议。',category:'fact',source:'issuer',relation:'supports'}]},
  {key:'conflicted',title:'存在冲突｜交易双方披露持股比例不一致',type:'acquisition',claims:[{text:'演示星河科技公告拟收购虚构晨星芯片60%股权。',category:'fact',source:'issuer',relation:'supports'},{text:'虚构晨星芯片股东表示仅同意出售51%股权，与60%的说法不一致。',category:'fact',source:'media',relation:'refutes',target:0}]},
  {key:'denied',title:'已否认｜公司澄清重组传闻',type:'acquisition',claims:[{text:'网传演示星河科技将与虚构远航集团进行重组。',category:'rumor',source:'rumor',relation:'supports'},{text:'演示星河科技公告：不存在与虚构远航集团重组的筹划或谈判。',category:'fact',source:'issuer',relation:'refutes',target:0}]},
  {key:'expired',title:'已失效｜意向协议超过有效期',type:'investment',claims:[{text:'演示星河科技签署虚构示范园投资意向书，有效期至2026年10月15日，未披露后续进展。',category:'fact',source:'issuer',relation:'supports',expiry:'2026-10-15T15:59:59.000Z'}]},
  {key:'corrected',title:'更正与历史｜合同金额由10亿更正为1亿',type:'other',claims:[{text:'演示星河科技披露虚构设备采购合同金额为10亿元。',category:'fact',source:'issuer',relation:'supports'},{text:'演示星河科技更正：虚构设备采购合同金额为1亿元，原10亿元系录入错误。',category:'fact',source:'issuer',relation:'corrects',target:0}]},
  {key:'repost',title:'转载与观点｜多个转载仍只有一个传闻源',type:'buyback',claims:[{text:'匿名帖称演示星河科技拟回购5亿元股份。',category:'rumor',source:'rumor',relation:'supports'},{text:'示例媒体转述匿名帖：演示星河科技拟回购5亿元股份。',category:'rumor',source:'media',relation:'supports',target:0,repost:0},{text:'示例研究员认为，若回购实施，可能改善市场预期。',category:'opinion',source:'research',relation:'supports',target:0}]},
];
let addedEvents=0, addedJobs=0;
tx(db, () => {
  for (const [kind,tier] of [['issuer',2],['media',3],['rumor',5],['research',4]] as const) {
    db.prepare("insert or ignore into sources(id,name,kind,tier,access_mode) values(?,?,?,?,'constructed')").run(id(kind),`构造演示来源（${kind}，非真实披露）`,kind,tier);
  }
  for (const scenario of cases) {
    const eid=id(scenario.key);
    if (db.prepare('select 1 from events where id=?').get(eid)) continue;
    db.prepare('insert into events(id,title,event_type,subject_code,matter_key,is_constructed) values(?,?,?,?,?,1)').run(eid,`【构造演示】${scenario.title}`,scenario.type,'DEMO-SCENARIO',eid);
    for (const [n,c] of scenario.claims.entries()) {
      const cid=id(`${scenario.key}-c${n}`), did=id(`${scenario.key}-d${n}`), vid=`${did}-v1`;
      const at=`2026-10-${String(10+n).padStart(2,'0')}T02:00:00.000Z`;
      const body=`【构造演示，所有公司、金额与事项均为虚构】${c.text}`;
      const repost='repost' in c ? id(`${scenario.key}-d${c.repost}`) : null;
      db.prepare('insert into documents(id,source_id,canonical_key,title,reposted_from_id,is_constructed) values(?,?,?,?,?,1)').run(did,id(c.source),did,`【构造演示】${scenario.title} · 资料${n+1}`,repost);
      db.prepare("insert into document_versions(id,document_id,body,content_hash,published_at,published_precision,fetched_at,analysis_status,subject_hint) values(?,?,?,?,?,'datetime',?,'done','DEMO-SCENARIO')").run(vid,did,body,contentHash(body),at,at);
      db.prepare("insert into claims(id,version_id,quote,quote_start,category,content,valid_until,review_status) values(?,?,?,?,?,?,?,'accepted')").run(cid,vid,c.text,body.indexOf(c.text),c.category,c.text,'expiry' in c ? c.expiry : null);
      db.prepare('insert into event_evidence(id,event_id,claim_id,relation,target_claim_id,reason,created_at) values(?,?,?,?,?,?,?)').run(`${eid}:${n}`,eid,cid,c.relation,'target' in c?id(`${scenario.key}-c${c.target}`):null,'构造演示：展示证据规则，非真实研究结果',at);
    }
    db.prepare("insert into event_instruments(event_id,code,name,link,reason) values(?,'DEMO-SCENARIO','演示星河科技（虚构）','direct','构造演示主体，不对应真实证券')").run(eid);
    addedEvents++;
  }
  const jobs=[
    {key:'complete',name:'完整结果',status:'completed',mode:'done'},
    {key:'empty',name:'零结果',status:'completed',mode:'empty'},
    {key:'partial',name:'覆盖受限与分析失败',status:'partial',mode:'mixed'},
    {key:'failed',name:'来源失败',status:'failed',mode:'empty'},
    {key:'cancelled',name:'取消后保留成果',status:'cancelled',mode:'done'},
  ];
  for (const [index,s] of jobs.entries()) {
    const jid=id(`research-${s.key}`),code=`DEMO-R${index+1}`;
    if(db.prepare('select 1 from research_jobs where id=?').get(jid))continue;
    db.prepare('insert into research_jobs(id,request_key,code,name,start_day,end_day,status,phase,error,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)').run(jid,jid,code,`【构造演示】${s.name}（虚构公司）`,'2026-10-10','2026-10-15',s.status,'done',s.status==='failed'?'构造演示：模拟来源连接失败，并非供应商真实故障':null,now,now);
    for(const source of ['ifind-notice','ifind-news','fuyao-news']) {
      const state={windows:[],cursor:'done',seen:[],requests:0,received:source==='ifind-notice'?(s.mode==='empty'?0:s.mode==='mixed'?4:1):0,excluded:0,unknownDates:s.mode==='mixed'&&source==='ifind-notice'?1:0,invalid:0,warnings:['构造演示：资料及处理结果为预设假数据，未调用数据源或模型'],continuable:false};
      db.prepare('insert into research_source_runs(job_id,source_id,status,state,error) values(?,?,?,?,?)').run(jid,source,s.status==='failed'?'failed':s.status==='partial'?'limited':s.status==='cancelled'?'pending':'exhausted',JSON.stringify(state),s.status==='failed'?'构造演示：模拟连接失败':null);
    }
    if(s.mode!=='empty') {
      const body=`【构造演示】${code}虚构公司董事会于2026年10月10日通过虚构设备采购计划，预算1亿元。`;
      const mid=saveMaterial(jid,{key:`${jid}-material`,sourceId:'ifind-notice',publisher:'构造演示公告（非真实披露）',title:'【构造演示】设备采购公告',body,url:null,publishedAt:'2026-10-10T02:00:00.000Z',contentKind:'snippet'},'inside',db);
      const analysis:Analysis={relevance:'direct',relevanceQuote:body,reason:'构造演示预设关联',warnings:['构造演示，未经模型分析'],events:[{title:'【构造演示】虚构设备采购计划',type:'investment',objectAnchor:'虚构设备',periodAnchor:null,claims:[{quote:body,category:'fact',occurredAt:'2026-10-10',validUntil:null,unit:'元',basis:'采购预算'}]}]};
      db.prepare("update research_documents set analysis_status='done',analysis=? where job_id=? and material_id=?").run(JSON.stringify(analysis),jid,mid);
      if(s.mode==='mixed') for(const state of ['pending','failed','excluded']) {
        const m=saveMaterial(jid,{key:`${jid}-${state}`,sourceId:'ifind-notice',publisher:'构造演示来源',title:`【构造演示】${state==='excluded'?'日期未知':state==='failed'?'分析失败':'待分析'}资料`,body:'【构造演示】虚构公司的片段资料，保留用于展示资料状态。',url:null,publishedAt:state==='excluded'?null:'2026-10-12T02:00:00.000Z',contentKind:'snippet'},state==='excluded'?'unknown':'inside',db);
        db.prepare('update research_documents set analysis_status=?,error=? where job_id=? and material_id=?').run(state,state==='failed'?'构造演示：模拟摘录校验失败':null,jid,m);
      }
      if(s.mode==='done') for(const group of groupAnalyses(materials(jid,db),code)) db.prepare("insert into research_relations(job_id,group_id,fingerprint,status,result) values(?,?,?,'done',?)").run(jid,group.id,groupFingerprint(group),JSON.stringify({links:[]}));
    }
    writeReport(jobById(jid,db)!,db);
    addedJobs++;
  }
});
for(const row of db.prepare('select id from events where id like ?').all(`${prefix}-%`)) replayHistory(String(row.id),now,db);
{
  const statuses=db.prepare('select distinct c.status from events e join conclusions c on e.current_conclusion_id=c.id where e.id like ?').all(`${prefix}-%`).map(r=>r.status);
  if(statuses.length!==5)throw new Error(`Expected five evidence statuses, got ${JSON.stringify(statuses)}`);
  if(db.prepare('pragma foreign_key_check').all().length)throw new Error('Foreign key validation failed');
}
console.log(JSON.stringify({addedEvents,addedJobs,events:db.prepare('select e.id,e.title,c.status from events e join conclusions c on c.id=e.current_conclusion_id where e.id like ?').all(`${prefix}-%`),research:db.prepare('select id,name,status from research_jobs where id like ?').all(`${prefix}-%`)}));
db.close();
