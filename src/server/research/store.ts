import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ResearchInput,
  SOURCE_LABEL,
  type ResearchJob,
  type SourceId,
  type SourceRun,
  type SourceState,
} from "@/domain/research";
import { getDb, tx } from "../db";
import type { ResearchItem } from "./providers";

const iso = () => new Date().toISOString();
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const LEASE_MS = 120_000;
export function listResearch(page = 1, db = getDb()) {
  const size = 10;
  const { total } = db.prepare("select count(*) as total from research_jobs").get() as { total: number };
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  const items = db.prepare(
    "select id, code, name, start_day, end_day, status, updated_at from research_jobs order by created_at desc, id desc limit ? offset ?",
  ).all(size, (current - 1) * size) as Pick<ResearchJob, "id" | "code" | "name" | "start_day" | "end_day" | "status" | "updated_at">[];
  return { items, total, page: current, pages };
}
export function createResearch(raw: unknown, requestKey: string, db = getDb()) {
  const input = ResearchInput.parse(raw);
  return tx(db, () => {
    const existing = db
      .prepare("select * from research_jobs where request_key = ?")
      .get(requestKey) as ResearchJob | undefined;
    if (existing) {
      if (
        existing.start_day !== input.start ||
        existing.end_day !== input.end ||
        (existing.code !== input.code &&
          existing.code.split(".")[0] !== input.code)
      )
        throw new Error("重复请求标识对应不同查询");
      return existing;
    }
    const active = db
      .prepare(
        "select count(*) as n from research_jobs where status in ('queued','running')",
      )
      .get() as { n: number };
    if (active.n >= 20) throw new Error("任务队列已满，请等待现有查询完成");
    const id = randomUUID(),
      now = iso();
    db.prepare(
      "insert into research_jobs(id,request_key,code,start_day,end_day,status,created_at,updated_at) values(?,?,?,?,?,'queued',?,?)",
    ).run(id, requestKey, input.code, input.start, input.end, now, now);
    for (const source of Object.keys(SOURCE_LABEL)) {
      const windows = [];
      for (
        let day = Date.parse(input.start);
        day <= Date.parse(input.end);
        day += 86400_000
      ) {
        const date = new Date(day).toISOString().slice(0, 10);
        windows.push({ start: date, end: date });
      }
      const state: SourceState = {
        windows: source.startsWith("ifind")
          ? windows
          : [{ start: input.start, end: input.end }],
        cursor: "first",
        seen: [],
        requests: 0,
        received: 0,
        excluded: 0,
        unknownDates: 0,
        invalid: 0,
        warnings: source.startsWith("ifind")
          ? ["语义检索片段，不保证穷尽全部资料"]
          : ["新闻摘要，不代表全文核验"],
      };
      db.prepare(
        "insert into research_source_runs(job_id,source_id,status,state) values(?,?,'pending',?)",
      ).run(id, source, JSON.stringify(state));
    }
    return jobById(id, db)!;
  });
}
export const jobById = (id: string, db = getDb()) =>
  db.prepare("select * from research_jobs where id = ?").get(id) as
    ResearchJob | undefined;
export const sourceRuns = (id: string, db = getDb()) =>
  db
    .prepare(
      "select * from research_source_runs where job_id = ? order by source_id",
    )
    .all(id) as SourceRun[];

/** A short transaction claims one job. Token fencing prevents a stale worker committing after recovery. */
export function claimJob(db = getDb()): ResearchJob | undefined {
  return tx(db, () => {
    const now = iso();
    const row = db
      .prepare(
        "select id from research_jobs where status in ('queued','running') and (lease_until is null or lease_until < ?) order by updated_at, created_at limit 1",
      )
      .get(now) as { id: string } | undefined;
    if (!row) return;
    db.prepare(
      "update research_jobs set status='running',lease_token=?,lease_until=?,updated_at=? where id=?",
    ).run(
      randomUUID(),
      new Date(Date.now() + LEASE_MS).toISOString(),
      now,
      row.id,
    );
    return jobById(row.id, db);
  });
}
export function owns(job: ResearchJob, db = getDb()) {
  const current = jobById(job.id, db);
  return (
    current?.status === "running" &&
    current.lease_token === job.lease_token &&
    current.lease_until! > iso()
  );
}
export function heartbeat(job: ResearchJob, db = getDb()) {
  db.prepare(
    "update research_jobs set lease_until=? where id=? and lease_token=? and status='running'",
  ).run(new Date(Date.now() + LEASE_MS).toISOString(), job.id, job.lease_token);
}
export function release(job: ResearchJob, db = getDb()) {
  db.prepare(
    "update research_jobs set lease_token=null,lease_until=null,updated_at=? where id=? and lease_token=?",
  ).run(iso(), job.id, job.lease_token);
}
export function cancelResearch(id: string, db = getDb()) {
  db.prepare(
    "update research_jobs set status='cancelled',lease_token=null,lease_until=null,updated_at=? where id=? and status in ('queued','running')",
  ).run(iso(), id);
  return jobById(id, db);
}
export function retryResearch(
  id: string,
  db = getDb(),
  extendCoverage = false,
) {
  return tx(db, () => {
    const job = jobById(id, db);
    if (!job || !["partial", "failed", "cancelled"].includes(job.status))
      return job;
    // Keep successful pages/materials; resume failed windows, cursors, and failed analyses.
    db.prepare(
      "update research_source_runs set status='pending',error=null where job_id=? and status in ('failed','unavailable')",
    ).run(id);
    for (const run of sourceRuns(id, db)) {
      const state = JSON.parse(run.state) as SourceState & {
        allowance?: number;
      };
      if (extendCoverage && run.status === "limited" && state.continuable) {
        state.continuable = false;
        state.warnings = state.warnings.filter((w) => !w.includes("检索预算"));
        state.allowance = state.requests + 100;
        db.prepare(
          "update research_source_runs set status='pending',state=? where job_id=? and source_id=?",
        ).run(JSON.stringify(state), id, run.source_id);
      }
    }
    db.prepare(
      "delete from research_relations where job_id=? and status='failed'",
    ).run(id);
    db.prepare(
      "update research_documents set analysis_status='pending',error=null where job_id=? and analysis_status='failed'",
    ).run(id);
    db.prepare(
      "update research_jobs set status='queued',error=null,lease_token=null,lease_until=null,updated_at=? where id=?",
    ).run(iso(), id);
    return jobById(id, db);
  });
}
export function saveMaterial(
  jobId: string,
  item: ResearchItem,
  range: "inside" | "unknown",
  db: DatabaseSync,
) {
  const bodyHash = hash(
      JSON.stringify([
        item.body,
        item.title,
        item.publishedAt,
        item.publisher,
        item.url,
      ]),
    ),
    id = hash(`${item.key}|${bodyHash}`);
  db.prepare(
    `insert or ignore into research_materials(id,provider_key,content_hash,source_id,publisher,title,body,url,published_at,fetched_at,content_kind)
    values(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    item.key,
    bodyHash,
    item.sourceId,
    item.publisher,
    item.title,
    item.body,
    item.url,
    item.publishedAt,
    iso(),
    item.contentKind,
  );
  db.prepare(
    "insert or ignore into research_documents(job_id,material_id,range_status,analysis_status) values(?,?,?,?)",
  ).run(jobId, id, range, range === "inside" ? "pending" : "excluded");
  return id;
}
export type Material = ResearchItem & {
  id: string;
  source_id: SourceId;
  published_at: string | null;
  fetched_at: string;
  content_kind: string;
  analysis_status: string;
  analysis: string | null;
  error: string | null;
  range_status: string;
};
export function materials(id: string, db = getDb()): Material[] {
  return db
    .prepare(
      "select m.*,d.analysis_status,d.analysis,d.error,d.range_status from research_documents d join research_materials m on m.id=d.material_id where d.job_id=? order by coalesce(m.published_at,'9999'),m.id",
    )
    .all(id) as unknown as Material[];
}
export function researchStatus(id: string, db = getDb(), offset = 0) {
  const job = jobById(id, db);
  if (!job) return null;
  const counts = db
    .prepare(
      "select analysis_status as status,count(*) as count from research_documents where job_id=? group by analysis_status",
    )
    .all(id) as { status: string; count: number }[];
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const documents = db
    .prepare(
      `select m.id,m.title,m.publisher,m.url,m.published_at,m.content_kind,m.body,d.range_status,d.analysis_status,d.analysis,d.error
    from research_documents d join research_materials m on m.id=d.material_id where d.job_id=? order by coalesce(m.published_at,'9999'),m.id limit 20 offset ?`,
    )
    .all(id, offset);
  const report = db
    .prepare(
      "select revision,generated_at,body from research_reports where job_id=?",
    )
    .get(id) as
    { revision: number; generated_at: string; body: string } | undefined;
  const { lease_token: _token, lease_until: _lease, ...publicJob } = job;
  return {
    job: publicJob,
    sources: sourceRuns(id, db).map((s) => ({
      ...s,
      state: JSON.parse(s.state) as SourceState,
    })),
    // node:sqlite may return null-prototype rows; React client props require plain objects.
    counts: counts.map((row) => ({ ...row })),
    total,
    documents: documents.map((row) => ({ ...row })),
    offset,
    report: report ? { ...report, body: JSON.parse(report.body) } : null,
  };
}
