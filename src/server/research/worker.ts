import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  type Instrument,
  type ResearchJob,
  type SourceState,
  type Window,
} from "@/domain/research";
import { getDb, tx } from "../db";
import {
  configured,
  fetchPage,
  publishedDay,
  resolveInstrument,
  type Page,
} from "./providers";
import {
  ANALYSIS_VERSION,
  extractResearch,
  groupAnalyses,
  groupFingerprint,
  reconcileGroup,
  type Analysis,
  type Links,
} from "./analysis";
import {
  claimJob,
  heartbeat,
  materials,
  owns,
  release,
  saveMaterial,
  sourceRuns,
} from "./store";

import { reportEvents, relationRecord, relationState } from "./report";
import { indexResearch } from "./library-index";

type Dependencies = {
  resolve: typeof resolveInstrument;
  fetch: typeof fetchPage;
  configured: typeof configured;
  extract: typeof extractResearch;
  reconcile: typeof reconcileGroup;
};
const live: Dependencies = {
  resolve: resolveInstrument,
  fetch: fetchPage,
  configured,
  extract: extractResearch,
  reconcile: reconcileGroup,
};
const now = () => new Date().toISOString();
/** Fence every state update in SQL, including errors and phase updates between transactions. */
function updateOwned(
  job: ResearchJob,
  db: DatabaseSync,
  sql: string,
  ...values: (string | number | null)[]
) {
  return db
    .prepare(
      `${sql} and exists (select 1 from research_jobs owner where owner.id=? and owner.lease_token=? and owner.status='running' and owner.lease_until>?)`,
    )
    .run(...values, job.id, job.lease_token, now());
}
function limit(source: string) {
  const raw = Number(
    process.env[
      source === "fuyao-news"
        ? "RESEARCH_MAX_NEWS_PAGES"
        : "RESEARCH_MAX_SEARCH_WINDOWS"
    ] || (source === "fuyao-news" ? 100 : 64),
  );
  return Number.isFinite(raw) && raw >= 1
    ? Math.min(Math.floor(raw), 2000)
    : 64;
}
export function splitWindow(window: Window): Window[] {
  if (window.start === window.end) return [];
  const start = Date.parse(window.start),
    end = Date.parse(window.end);
  const mid = start + Math.floor((end - start) / 86400_000 / 2) * 86400_000;
  return [
    { start: window.start, end: new Date(mid).toISOString().slice(0, 10) },
    {
      start: new Date(mid + 86400_000).toISOString().slice(0, 10),
      end: window.end,
    },
  ];
}

export function writeReport(job: ResearchJob, db = getDb()) {
  const at = now();
  const events = reportEvents(job, db, at);
  const body = {
    code: job.code,
    name: job.name,
    start: job.start_day,
    end: job.end_day,
    events,
    disclaimer:
      "仅分析已收录片段/摘要；自动结果未经人工确认，不代表全网覆盖或全文核验。首次来源指已收录资料中最早可追溯的一条。",
  };
  db.prepare(
    `insert into research_reports(job_id,revision,generated_at,body) values(?,1,?,?)
    on conflict(job_id) do update set revision=research_reports.revision+1,generated_at=excluded.generated_at,body=excluded.body`,
  ).run(job.id, at, JSON.stringify(body));
  const report = db.prepare("select revision from research_reports where job_id=?").get(job.id) as { revision: number };
  indexResearch(job, events, report.revision, at, db);
}

async function fetchStep(
  job: ResearchJob,
  deps: Dependencies,
  db: DatabaseSync,
) {
  const run = sourceRuns(job.id, db)
    .filter((r) => ["pending", "running"].includes(r.status))
    .sort(
      (a, b) => JSON.parse(a.state).requests - JSON.parse(b.state).requests,
    )[0];
  if (!run) return false;
  const state = JSON.parse(run.state) as SourceState;
  if (!deps.configured(run.source_id)) {
    updateOwned(
      job,
      db,
      "update research_source_runs set status='unavailable',error='数据源凭证未配置' where job_id=? and source_id=?",
      job.id,
      run.source_id,
    );
    return true;
  }
  const allowance =
    (state as SourceState & { allowance?: number }).allowance ??
    limit(run.source_id);
  if (state.requests >= allowance) {
    state.continuable = true;
    state.warnings.push(
      "达到本轮检索预算，仍可能有未获取资料；可点击继续检索更多资料",
    );
    updateOwned(
      job,
      db,
      "update research_source_runs set status='limited',state=? where job_id=? and source_id=?",
      JSON.stringify(state),
      job.id,
      run.source_id,
    );
    return true;
  }
  updateOwned(
    job,
    db,
    "update research_source_runs set status='running' where job_id=? and source_id=?",
    job.id,
    run.source_id,
  );
  const window = state.windows[0] ?? { start: job.start_day, end: job.end_day };
  let page: Page;
  try {
    page = await deps.fetch(
      run.source_id,
      { code: job.code, name: job.name! },
      window,
      state.cursor,
    );
  } catch {
    if (owns(job, db))
      updateOwned(
        job,
        db,
        "update research_source_runs set status='failed',error='数据源请求失败或返回异常，请重试；已有资料已保留' where job_id=? and source_id=?",
        job.id,
        run.source_id,
      );
    return true;
  }
  if (!owns(job, db)) return true;
  tx(db, () => {
    if (!owns(job, db)) return;
    state.continuable = false;
    state.requests++;
    state.received += page.items.length;
    state.invalid += page.invalid;
    let outsideWindow = 0;
    for (const item of page.items) {
      const day = publishedDay(item.publishedAt);
      if (!day) {
        state.unknownDates++;
        saveMaterial(job.id, item, "unknown", db);
        continue;
      }
      if (day < window.start || day > window.end) outsideWindow++;
      if (day < job.start_day || day > job.end_day) {
        state.excluded++;
        continue;
      }
      saveMaterial(job.id, item, "inside", db);
    }
    let status = "running";
    if (run.source_id === "fuyao-news") {
      if (page.exhausted) status = "exhausted";
      else if (
        !page.next ||
        page.next === state.cursor ||
        state.seen.includes(page.next)
      ) {
        status = "limited";
        state.warnings.push("供应商返回重复或缺失游标，无法继续，覆盖可能截断");
      } else {
        state.seen.push(state.cursor);
        state.cursor = page.next;
      }
    } else {
      state.windows.shift();
      if (outsideWindow)
        state.warnings.push(
          "供应商返回区间外资料，已在本地按披露日过滤；历史覆盖不可靠",
        );
      if (page.rawCount >= 20) {
        const split = splitWindow(window);
        if (split.length) state.windows.unshift(...split);
        else state.warnings.push(`${window.start} 命中单日数量上限，可能截断`);
      }
      if (!state.windows.length) status = "limited";
    }
    if (page.invalid)
      state.warnings.push("部分返回项无有效标题或正文，未作为资料收录");
    state.warnings = [...new Set(state.warnings)];
    updateOwned(
      job,
      db,
      "update research_source_runs set status=?,state=?,error=null where job_id=? and source_id=?",
      status,
      JSON.stringify(state),
      job.id,
      run.source_id,
    );
  });
  return true;
}

async function analyzeStep(
  job: ResearchJob,
  deps: Dependencies,
  db: DatabaseSync,
) {
  const row = materials(job.id, db).find(
    (m) => m.analysis_status === "pending" && m.range_status === "inside",
  );
  if (!row) return false;
  try {
    const cache = db
      .prepare(
        "select analysis from research_analysis_cache where material_id=? and code=? and analysis_version=?",
      )
      .get(row.id, job.code, ANALYSIS_VERSION) as
      { analysis: string } | undefined;
    const result: Analysis = cache
      ? JSON.parse(cache.analysis)
      : await deps.extract(row, { code: job.code, name: job.name! });
    if (!owns(job, db)) return true;
    tx(db, () => {
      if (!owns(job, db)) return;
      db.prepare(
        "insert or ignore into research_analysis_cache(material_id,code,analysis_version,analysis) values(?,?,?,?)",
      ).run(row.id, job.code, ANALYSIS_VERSION, JSON.stringify(result));
      updateOwned(
        job,
        db,
        "update research_documents set analysis_status='done',analysis=?,error=null where job_id=? and material_id=?",
        JSON.stringify(result),
        job.id,
        row.id,
      );
      writeReport(job, db);
    });
  } catch (error) {
    const detail =
      error instanceof z.ZodError
        ? `模型结构不符：${error.issues
            .map((i) => i.path.join("."))
            .join("、")
            .slice(0, 300)}`
        : error instanceof Error && !error.message.includes("http")
          ? error.message.slice(0, 300)
          : "模型调用或证据校验失败";
    if (owns(job, db))
      updateOwned(
        job,
        db,
        "update research_documents set analysis_status='failed',error=? where job_id=? and material_id=?",
        `${detail}；资料已保留，可重试分析`,
        job.id,
        row.id,
      );
  }
  return true;
}

async function relationStep(
  job: ResearchJob,
  deps: Dependencies,
  db: DatabaseSync,
) {
  for (const group of groupAnalyses(materials(job.id, db), job.code)) {
    const fingerprint = groupFingerprint(group);
    const existing = relationRecord(job.id, group, db);
    if (existing?.fingerprint === fingerprint && ["done", "failed"].includes(relationState(job.id, group, db))) continue;
    tx(db, () => {
      if (!owns(job, db)) return;
      db.prepare(`insert into research_relations(job_id,group_id,fingerprint,status) values(?,?,?,'running')
        on conflict(job_id,group_id) do update set fingerprint=excluded.fingerprint,status='running',result=null,error=null`).run(job.id, group.id, fingerprint);
      db.prepare(`insert into research_relation_leases(job_id,group_id,lease_token) values(?,?,?)
        on conflict(job_id,group_id) do update set lease_token=excluded.lease_token`).run(job.id, group.id, job.lease_token);
      writeReport(job, db);
    });
    if (!owns(job, db)) return true;
    let result: Links | null = null,
      error: string | null = null;
    try {
      result = await deps.reconcile(group);
    } catch {
      error = "证据关系分析失败或存在不明确引用，保留双方摘录，待核实";
    }
    if (!owns(job, db)) return true;
    tx(db, () => {
      if (!owns(job, db)) return;
      db.prepare(
        `insert into research_relations(job_id,group_id,fingerprint,status,result,error) values(?,?,?,?,?,?)
        on conflict(job_id,group_id) do update set fingerprint=excluded.fingerprint,status=excluded.status,result=excluded.result,error=excluded.error`,
      ).run(
        job.id,
        group.id,
        fingerprint,
        error ? "failed" : "done",
        result ? JSON.stringify(result) : null,
        error,
      );
      writeReport(job, db);
    });
    return true;
  }
  return false;
}

/** One bounded, checkpointed unit. Fetch and analysis alternate so results appear before all pages finish. */
export async function workOnce(
  db = getDb(),
  overrides: Partial<Dependencies> = {},
) {
  const deps = { ...live, ...overrides },
    job = claimJob(db);
  if (!job) return false;
  const timer = setInterval(() => heartbeat(job, db), 20_000);
  try {
    if (!job.name) {
      const instrument: Instrument = await deps.resolve(job.code);
      if (owns(job, db))
        updateOwned(
          job,
          db,
          "update research_jobs set code=?,name=?,phase='fetch' where id=?",
          instrument.code,
          instrument.name,
          job.id,
        );
      return true;
    }
    if (job.phase === "analyze" && (await analyzeStep(job, deps, db))) {
      if (owns(job, db))
        updateOwned(
          job,
          db,
          "update research_jobs set phase='fetch' where id=?",
          job.id,
        );
      return true;
    }
    if (await fetchStep(job, deps, db)) {
      if (owns(job, db))
        updateOwned(
          job,
          db,
          "update research_jobs set phase='analyze' where id=?",
          job.id,
        );
      return true;
    }
    if (!owns(job, db)) return true;
    if (await analyzeStep(job, deps, db)) return true;
    updateOwned(
      job,
      db,
      "update research_jobs set phase='relations' where id=?",
      job.id,
    );
    if (await relationStep(job, deps, db)) return true;
    if (!owns(job, db)) return true;
    const runs = sourceRuns(job.id, db),
      rows = materials(job.id, db);
    const relationFailed = db
      .prepare(
        "select 1 from research_relations where job_id=? and status='failed' limit 1",
      )
      .get(job.id);
    const failed =
      runs.every((r) => ["failed", "unavailable"].includes(r.status)) &&
      !rows.length;
    const partial =
      runs.some(
        (r) => r.status !== "exhausted" || JSON.parse(r.state).invalid > 0,
      ) ||
      rows.some((m) => ["failed", "excluded"].includes(m.analysis_status)) ||
      Boolean(relationFailed);
    tx(db, () => {
      if (!owns(job, db)) return;
      writeReport(job, db);
      updateOwned(
        job,
        db,
        "update research_jobs set status=?,phase='finished',error=? where id=?",
        failed ? "failed" : partial ? "partial" : "completed",
        failed ? "未能获取任何可用资料，请检查数据源配置或重试" : null,
        job.id,
      );
    });
  } catch {
    if (owns(job, db))
      updateOwned(
        job,
        db,
        "update research_jobs set status='failed',error='标的解析或任务处理失败，请检查配置和股票代码后重试' where id=?",
        job.id,
      );
  } finally {
    clearInterval(timer);
    release(job, db);
  }
  return true;
}
