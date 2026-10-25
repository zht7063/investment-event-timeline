import type { DatabaseSync } from 'node:sqlite';
import type { ResearchJob } from '@/domain/research';
import { groupAnalyses, groupFingerprint, concludeGroup, type Group, type Links } from './analysis';
import { materials, hash } from './store';

export type RelationState = 'pending' | 'running' | 'done' | 'failed';
// Old unanchored group IDs omitted the stock code. Read their results without rewriting history.
export function relationRecord(jobId: string, group: Group, db: DatabaseSync) {
  const legacy = group.merge.startsWith('独立') ? hash(group.evidence[0].id.split(':').slice(0, 2).join('|')) : group.id;
  return db.prepare(`select * from research_relations where job_id=? and group_id in (?,?) order by (group_id=?) desc limit 1`)
    .get(jobId, group.id, legacy, group.id) as { status: string; fingerprint: string; result: string | null; error: string | null; group_id: string } | undefined;
}
export function relationState(jobId: string, group: Group, db: DatabaseSync): RelationState {
  const r = relationRecord(jobId, group, db);
  if (!r || r.fingerprint !== groupFingerprint(group)) return 'pending';
  if (r.status === 'done' || r.status === 'failed') return r.status;
  const lease = db.prepare(`select 1 from research_relation_leases l join research_jobs j on j.id=l.job_id
    where l.job_id=? and l.group_id=? and j.status='running' and j.lease_token=l.lease_token and j.lease_until>?`).get(jobId, group.id, new Date().toISOString());
  return r.status === 'running' && lease ? 'running' : 'pending';
}
export function reportEvents(job: ResearchJob, db: DatabaseSync, at: string) {
  return groupAnalyses(materials(job.id, db), job.code).map(group => {
    const relationStatus = relationState(job.id, group, db);
    const relation = relationRecord(job.id, group, db);
    return { ...concludeGroup(group, relationStatus === 'done' ? JSON.parse(relation!.result!) as Links : { links: [] }, at),
      relationStatus, relationError: relationStatus === 'failed' ? relation?.error ?? null : null };
  });
}
export type ReportEvent = ReturnType<typeof reportEvents>[number];
