import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/server/db";
import {
  createResearch,
  jobById,
  claimJob,
  cancelResearch,
  retryResearch,
  materials,
  researchStatus,
  owns,
  saveMaterial,
} from "@/server/research/store";
import { workOnce, splitWindow } from "@/server/research/worker";
import {
  validateAnalysis,
  groupAnalyses,
  validateLinks,
  concludeGroup,
} from "@/server/research/analysis";
import {
  parseIfindRows,
  publishedDay,
  type ResearchItem,
} from "@/server/research/providers";
import { parseRpc } from "@/server/sources/mcp";
import { ResearchInput } from "@/domain/research";
const dbs: ReturnType<typeof openDb>[] = [];
const db = () => {
  const d = openDb(":memory:");
  dbs.push(d);
  return d;
};
afterEach(() => {
  dbs.forEach((d) => d.close());
  dbs.length = 0;
  vi.unstubAllEnvs();
});
const input = { code: "300308.SZ", start: "2026-09-01", end: "2026-09-07" };
const instrument = { code: "300308.SZ", name: "中际旭创" };
const item = (
  key: string,
  body = "中际旭创披露：2026年9月甲方项目收购完成。",
  date = "2026-09-02",
): ResearchItem => ({
  key,
  title: "中际旭创公告",
  body,
  publishedAt: date,
  publisher: "公司公告",
  sourceId: "ifind-notice",
  contentKind: "snippet",
  url: null,
});
const extraction = (quote: string) => ({
  relevance: "direct",
  relevanceQuote: quote,
  reason: "正文提及目标公司",
  events: [
    {
      title: "甲方项目收购",
      type: "acquisition",
      objectAnchor: "甲方项目",
      periodAnchor: "2026年9月",
      claims: [
        {
          quote,
          category: "fact",
          occurredAt: null,
          validUntil: null,
          unit: null,
          basis: null,
        },
      ],
    },
  ],
});
const dependencies = {
  resolve: vi.fn(async () => instrument),
  configured: () => true,
  fetch: vi.fn(async () => ({
    items: [],
    next: null,
    exhausted: true,
    rawCount: 0,
    invalid: 0,
  })),
  extract: async (m: Parameters<typeof validateAnalysis>[1]) =>
    validateAnalysis(extraction(m.body), m, instrument),
  reconcile: async () => ({ links: [] }),
};
async function drain(d: ReturnType<typeof db>, overrides = {}) {
  for (let i = 0; i < 60; i++)
    if (!(await workOnce(d, { ...dependencies, ...overrides }))) return;
  throw new Error("task did not terminate");
}

describe("research validation and provider semantics", () => {
  it("returns React-serializable records when SQLite rows have null prototypes", () => {
    const d = db();
    const job = createResearch(input, "serializable-status", d);
    saveMaterial(job.id, item("serialization"), "inside", d);
    // Match newer node:sqlite row objects even on older development runtimes.
    const prepare = d.prepare.bind(d);
    const spy = vi.spyOn(d, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      return new Proxy(statement, {
        get(target, key) {
          if (key === "all")
            return (...args: Parameters<typeof statement.all>) =>
              target.all(...args).map((row) => Object.assign(Object.create(null), row));
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    try {
      const status = researchStatus(job.id, d)!;
      expect(status.total).toBe(1);
      expect(status.documents[0].title).toBe("中际旭创公告");
      for (const row of [...status.counts, ...status.documents])
        expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects invalid dates, reversed ranges and non-stock input", () => {
    expect(
      ResearchInput.safeParse({ ...input, start: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      ResearchInput.safeParse({ ...input, start: "2026-09-09" }).success,
    ).toBe(false);
    expect(ResearchInput.safeParse({ ...input, code: "DEMO-A" }).success).toBe(
      false,
    );
    expect(publishedDay("2026-09-01T17:00:00Z")).toBe("2026-09-02");
    expect(publishedDay("2026-09")).toBeNull();
  });
  it("splits inclusive dates without holes or overlap", () => {
    expect(splitWindow({ start: "2026-09-01", end: "2026-09-02" })).toEqual([
      { start: "2026-09-01", end: "2026-09-01" },
      { start: "2026-09-02", end: "2026-09-02" },
    ]);
    expect(splitWindow({ start: "2026-09-01", end: "2026-09-01" })).toEqual([]);
  });
  it("separates known zero results from business, MCP, and format errors", () => {
    expect(
      parseIfindRows({
        code: 1,
        data: "# 查询结果\n抱歉，本次新闻搜索结果为空",
      }),
    ).toEqual([]);
    expect(
      parseIfindRows({ code: 1, data: { data: '[{"日期":"2026-09-01"}]' } }),
    ).toHaveLength(1);
    expect(() => parseIfindRows({ code: 401, data: [] })).toThrow();
    expect(() =>
      parseIfindRows({ code: 1, data: "service unavailable" }),
    ).toThrow();
    expect(() =>
      parseRpc('{"result":{"isError":true,"content":[]}}'),
    ).toThrow();
    expect(() => parseRpc('data: {"error":{"code":-1}}\n')).toThrow();
  });
});

describe("durable query pipeline", () => {
  it("creates an idempotent job and fences recovered and cancelled workers", () => {
    const d = db(),
      job = createResearch(input, "request-1", d);
    expect(createResearch(input, "request-1", d).id).toBe(job.id);
    expect(() =>
      createResearch({ ...input, start: "2026-09-02" }, "request-1", d),
    ).toThrow();
    const first = claimJob(d)!;
    expect(claimJob(d)).toBeUndefined();
    d.prepare(
      "update research_jobs set lease_until='2000-01-01' where id=?",
    ).run(job.id);
    const second = claimJob(d)!;
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(owns(first, d)).toBe(false);
    cancelResearch(job.id, d);
    expect(owns(second, d)).toBe(false);
  });
  it("resolves an unconfigured stock, advances pages, excludes future dates and analyzes without manual confirmation", async () => {
    const d = db(),
      job = createResearch(input, "request-2", d),
      calls: string[] = [];
    await drain(d, {
      fetch: async (
        source: string,
        _i: unknown,
        _w: unknown,
        cursor: string,
      ) => {
        calls.push(`${source}:${cursor}`);
        return {
          items:
            source === "fuyao-news"
              ? [
                  item(cursor),
                  item("outside", undefined, "2026-10-01"),
                  { ...item("unknown"), publishedAt: null },
                ]
              : [],
          next: source === "fuyao-news" && cursor === "first" ? "second" : null,
          exhausted: cursor === "second" || source !== "fuyao-news",
          rawCount: 3,
          invalid: 0,
        };
      },
    });
    expect(calls).toContain("fuyao-news:second");
    expect(jobById(job.id, d)?.name).toBe(instrument.name);
    const docs = materials(job.id, d);
    expect(docs).toHaveLength(3);
    expect(docs.filter((m) => m.analysis_status === "done")).toHaveLength(2);
    expect(docs.some((m) => m.published_at === "2026-10-01")).toBe(false);
    const status = researchStatus(job.id, d)!;
    expect(status.report?.body.events).toHaveLength(1);
    expect(status.report?.body.events[0].evidence).toHaveLength(2);
    expect(status.job.status).toBe("partial");
  });
  it("keeps a checkpoint across failure and retries only failed work", async () => {
    const d = db(),
      job = createResearch(input, "request-3", d);
    let fail = true;
    const cursors: string[] = [];
    const fetch = async (
      source: string,
      _i: unknown,
      _w: unknown,
      cursor: string,
    ) => {
      if (source !== "fuyao-news")
        return {
          items: [],
          next: null,
          exhausted: false,
          rawCount: 0,
          invalid: 0,
        };
      cursors.push(cursor);
      if (cursor === "second" && fail) throw new Error("offline");
      return {
        items: [item(cursor)],
        next: cursor === "first" ? "second" : null,
        exhausted: cursor === "second",
        rawCount: 1,
        invalid: 0,
      };
    };
    await drain(d, { fetch });
    expect(materials(job.id, d)).toHaveLength(1);
    fail = false;
    retryResearch(job.id, d);
    await drain(d, { fetch });
    expect(cursors).toEqual(["first", "second", "second"]);
    expect(materials(job.id, d)).toHaveLength(2);
  });
  it("does not commit an in-flight result after cancellation", async () => {
    const d = db(),
      job = createResearch(input, "request-4", d);
    await workOnce(d, dependencies);
    await workOnce(d, {
      ...dependencies,
      fetch: async () => {
        cancelResearch(job.id, d);
        return {
          items: [item("discard")],
          next: null,
          exhausted: true,
          rawCount: 1,
          invalid: 0,
        };
      },
    });
    expect(materials(job.id, d)).toHaveLength(0);
    expect(jobById(job.id, d)?.status).toBe("cancelled");
  });
  it("detects repeated cursors and does not call them indefinitely", async () => {
    const d = db(),
      job = createResearch(input, "request-5", d);
    await drain(d, {
      fetch: async () => ({
        items: [],
        next: "first",
        exhausted: false,
        rawCount: 0,
        invalid: 0,
      }),
    });
    expect(
      researchStatus(job.id, d)
        ?.sources.find((s) => s.source_id === "fuyao-news")
        ?.state.warnings.join(),
    ).toMatch(/重复/);
  });
  it("keeps model failures and allows retry without redownloading", async () => {
    const d = db(),
      job = createResearch(input, "request-6", d);
    const fetch = vi.fn(async () => ({
      items: [item("one")],
      next: null,
      exhausted: true,
      rawCount: 1,
      invalid: 0,
    }));
    await drain(d, {
      fetch,
      extract: async () => {
        throw new Error("bad output");
      },
    });
    expect(materials(job.id, d)[0].analysis_status).toBe("failed");
    const previous = fetch.mock.calls.length;
    retryResearch(job.id, d);
    await drain(d, { fetch });
    expect(materials(job.id, d)[0].analysis_status).toBe("done");
    expect(fetch.mock.calls.length).toBe(previous);
  });
});

describe("grounded automatic analysis", () => {
  it("splits multiple matters and rejects fabricated excerpts", () => {
    const body =
      "中际旭创披露：2026年9月甲方项目收购完成。另：2026年9月乙方项目拟收购。";
    const raw = extraction(body);
    raw.events.push({
      ...raw.events[0],
      objectAnchor: "乙方项目",
      title: "乙方项目",
      claims: [{ ...raw.events[0].claims[0], quote: "不在原文" }],
    });
    const valid = validateAnalysis(raw, { title: "公告", body }, instrument);
    expect(valid.events).toHaveLength(1);
    expect(valid.warnings.join()).toMatch(/摘录/);
    raw.events[1].claims[0].quote = "另：2026年9月乙方项目拟收购。";
    expect(
      validateAnalysis(raw, { title: "公告", body }, instrument).events,
    ).toHaveLength(2);
  });
  it("keeps ambiguous identity separate and quotes without stock relevance out of conclusions", () => {
    const body = "其他公司披露2026年9月甲方项目收购完成。";
    expect(
      validateAnalysis(
        extraction(body),
        { title: "其他公司公告", body },
        instrument,
      ).relevance,
    ).toBe("uncertain");
    const raw = extraction("中际旭创披露收购计划。");
    raw.events[0].objectAnchor = "不存在的项目";
    expect(
      validateAnalysis(
        raw,
        { title: "公告", body: "中际旭创披露收购计划。" },
        instrument,
      ).events[0].objectAnchor,
    ).toBeNull();
  });
  it("preserves both sides of contradiction and targets corrections; rejects invalid links", () => {
    const d = db(),
      job = createResearch(input, "request-7", d);
    const a = item("a"),
      b = item(
        "b",
        "中际旭创更正：2026年9月甲方项目收购未完成。",
        "2026-09-03",
      );
    for (const value of [a, b]) {
      const id = saveMaterial(job.id, value, "inside", d);
      d.prepare(
        "update research_documents set analysis_status='done',analysis=? where material_id=?",
      ).run(
        JSON.stringify(
          validateAnalysis(
            extraction(value.body),
            { title: value.title, body: value.body },
            instrument,
          ),
        ),
        id,
      );
    }
    const group = groupAnalyses(materials(job.id, d), input.code)[0],
      [first, second] = group.evidence;
    const links = {
      links: [
        {
          from: second.id,
          to: first.id,
          relation: "refutes",
          reason: "明确否认已完成",
          fromQuote: second.quote,
          toQuote: first.quote,
        },
      ],
    };
    expect(
      concludeGroup(
        group,
        validateLinks(links, group),
        new Date().toISOString(),
      ).conclusion.status,
    ).toBe("conflicted");
    const corrected = concludeGroup(
      group,
      validateLinks(
        { links: [{ ...links.links[0], relation: "corrects" }] },
        group,
      ),
      new Date().toISOString(),
    );
    expect(corrected.conclusion.supersededIds).toEqual([first.id]);
    expect(corrected.evidence).toHaveLength(2);
    expect(() =>
      validateLinks({ links: [{ ...links.links[0], to: "fake" }] }, group),
    ).toThrow();
    second.unit = "万元";
    expect(() => validateLinks(links, group)).toThrow(/单位/);
  });
});

it("recovers a file-backed queue in a new process without losing cursor state", () => {
  const directory = mkdtempSync(join(tmpdir(), "research-restart-")),
    path = join(directory, "db.sqlite");
  try {
    let d = openDb(path);
    const job = createResearch(
      { ...input, code: "600519", end: input.start },
      "restart-request",
      d,
    );
    d.close();
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/research-step.ts", path],
      { stdio: "pipe" },
    );
    d = openDb(path);
    expect(jobById(job.id, d)?.name).toBe("构造测试公司");
    const interrupted = claimJob(d)!;
    d.prepare(
      "update research_jobs set lease_until='2000-01-01' where id=?",
    ).run(job.id);
    d.close();
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/research-step.ts", path],
      { stdio: "pipe" },
    );
    d = openDb(path);
    expect(owns(interrupted, d)).toBe(false);
    expect(
      researchStatus(job.id, d)!.sources.reduce(
        (n, s) => n + s.state.requests,
        0,
      ),
    ).toBe(1);
    d.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not turn an empty event extraction into a model outage", () => {
  const result = validateAnalysis(
    {
      relevance: "direct",
      relevanceQuote: "中际旭创",
      reason: "行情片段只列出公司名",
      events: [],
    },
    { title: "中际旭创", body: "行情列表" },
    instrument,
  );
  expect(result.events).toHaveLength(0);
  expect(result.warnings.join()).toMatch(/未识别/);
});

it("keeps ungrounded model times unknown instead of expiring valid evidence", () => {
  const body = "中际旭创披露：2026年9月甲方项目收购完成。";
  const raw = extraction(body);
  const timed = {
    ...raw,
    events: [
      {
        ...raw.events[0],
        claims: [
          {
            ...raw.events[0].claims[0],
            occurredAt: "2025-01-01",
            validUntil: "2026-09-01",
          },
        ],
      },
    ],
  };
  const checked = validateAnalysis(timed, { title: "公告", body }, instrument);
  expect(checked.events[0].claims[0].occurredAt).toBeNull();
  expect(checked.events[0].claims[0].validUntil).toBeNull();
  expect(checked.warnings.join()).toMatch(/未知时间/);
});

it("does not extend fetch budgets when retrying failed analysis", async () => {
  vi.stubEnv("RESEARCH_MAX_NEWS_PAGES", "1");
  const d = db(),
    job = createResearch({ ...input, end: input.start }, "budget-retry", d);
  const fetch = vi.fn(async (source: string) => ({
    items: [],
    next: source === "fuyao-news" ? "second" : null,
    exhausted: false,
    rawCount: 0,
    invalid: 0,
  }));
  await drain(d, { fetch });
  const count = fetch.mock.calls.length;
  expect(researchStatus(job.id, d)!.sources[0].state.continuable).toBe(true);
  retryResearch(job.id, d);
  await drain(d, { fetch });
  expect(fetch.mock.calls.length).toBe(count);
  retryResearch(job.id, d, true);
  const exhausted = vi.fn(async () => ({
    items: [],
    next: null,
    exhausted: true,
    rawCount: 0,
    invalid: 0,
  }));
  await drain(d, { fetch: exhausted });
  expect(exhausted).toHaveBeenCalledTimes(1);
});
