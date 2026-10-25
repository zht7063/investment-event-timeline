import type { DatabaseSync } from 'node:sqlite';
import type { ResearchJob } from '@/domain/research';
import { reportEvents, type ReportEvent } from './report';
import { tx } from '../db';

/** Caller owns the transaction; this must commit together with the analysis/report. */
export function indexResearch(job: ResearchJob, events: ReportEvent[], revision: number, at: string, db: DatabaseSync) {
  db.prepare('delete from library_event_research where job_id=?').run(job.id);
  for (const event of events) {
    db.prepare('insert or ignore into library_events(id,code,merge_key) values(?,?,?)').run(event.id, job.code, event.id);
    db.prepare(`insert into library_event_research(event_id,job_id,title,report_revision,updated_at,snapshot) values(?,?,?,?,?,?)`)
      .run(event.id, job.id, event.title, revision, at, JSON.stringify(event));
    for (const materialId of new Set(event.evidence.map(e => e.materialId))) {
      db.prepare('insert into library_event_materials(event_id,job_id,material_id) values(?,?,?)').run(event.id, job.id, materialId);
    }
  }
  db.prepare('delete from library_events where not exists(select 1 from library_event_research r where r.event_id=library_events.id)').run();
}
export function backfillLibrary(db: DatabaseSync, dryRun = false) {
  const jobs = db.prepare('select * from research_jobs order by created_at,id').all() as ResearchJob[];
  const result = { jobs: jobs.length, indexed: 0, associations: 0, failures: [] as { jobId: string; error: string }[] };
  for (const job of jobs) {
    try {
      const count = tx(db, () => {
        const report = db.prepare('select revision,generated_at from research_reports where job_id=?').get(job.id) as { revision: number; generated_at: string } | undefined;
        const at = report?.generated_at ?? job.updated_at;
        const events = reportEvents(job, db, at);
        if (!dryRun) indexResearch(job, events, report?.revision ?? 0, at, db);
        return events.length;
      });
      result.indexed++;
      result.associations += count;
    } catch (e) { result.failures.push({ jobId: job.id, error: e instanceof Error ? e.message : '索引失败' }); }
  }
  return result;
}
