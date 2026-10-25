import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "@/server/db";
import { resetToSeed } from "@/server/seed";
import {
  acquireLock,
  configuredProviderIds,
  lockedSync,
  PROVIDERS,
  registerProviders,
  syncCodes,
  syncSource,
  type SyncResult,
} from "@/server/sources/sync";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let db: DatabaseSync;
const T0 = "2026-10-25T00:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  resetToSeed(db, T0);
  // Clear any provider env vars so tests start unconfigured
  delete process.env.FUYAO_API_KEY;
  delete process.env.FUYAO_BASE_URL;
  delete process.env.FUYAO_MCP_A_SHARE_URL;
  delete process.env.IFIND_TOKEN;
  delete process.env.IFIND_MCP_URL;
  delete process.env.SYNC_CODES;
});

describe("registerProviders", () => {
  it("creates source rows for all providers in unavailable mode when unconfigured", () => {
    registerProviders(db);
    const sources = db.prepare("select id, access_mode, last_error from sources where id in ('ifind-notice','ifind-news','fuyao-news')").all() as {
      id: string; access_mode: string; last_error: string | null;
    }[];
    expect(sources).toHaveLength(3);
    for (const s of sources) {
      expect(s.access_mode).toBe("unavailable");
      expect(s.last_error).toMatch(/未配置/);
    }
  });

  it("switches to live mode when env vars are set", () => {
    process.env.IFIND_TOKEN = "test-token";
    process.env.IFIND_MCP_URL = "https://example.com/mcp";
    registerProviders(db);
    const row = db.prepare("select access_mode, last_error from sources where id = 'ifind-notice'").get() as {
      access_mode: string; last_error: string | null;
    };
    expect(row.access_mode).toBe("live");
    expect(row.last_error).toBeNull();
  });
});

describe("syncCodes", () => {
  it("returns real codes from env and linked instruments, filtering out DEMO-* codes", () => {
    // Seed data uses DEMO-* codes in event_instruments
    const codes = syncCodes(db);
    expect(codes.every((c) => /^\d{6}\.(SZ|SH|BJ)$/.test(c))).toBe(true);
    // DEMO-* codes from seed should be excluded
    expect(codes.every((c) => !c.startsWith("DEMO"))).toBe(true);
  });

  it("includes codes from SYNC_CODES env var", () => {
    process.env.SYNC_CODES = "300308.SZ, 600519.SH";
    const codes = syncCodes(db);
    expect(codes).toContain("300308.SZ");
    expect(codes).toContain("600519.SH");
  });

  it("deduplicates codes", () => {
    process.env.SYNC_CODES = "300308.SZ,300308.SZ";
    const codes = syncCodes(db);
    expect(codes.filter((c) => c === "300308.SZ")).toHaveLength(1);
  });
});

describe("configuredProviderIds", () => {
  it("returns empty when nothing is configured", () => {
    expect(configuredProviderIds()).toEqual([]);
  });

  it("returns ifind providers when IFIND env is set", () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    const ids = configuredProviderIds();
    expect(ids).toContain("ifind-notice");
    expect(ids).toContain("ifind-news");
    expect(ids).not.toContain("fuyao-news");
  });
});

describe("syncSource", () => {
  it("reports credential error when provider is not configured", async () => {
    registerProviders(db);
    const result = await syncSource("ifind-notice", db, { analyze: false });
    expect(result.status).toBe("failed");
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/未配置/)]));
    // sync_runs row should be written
    const run = db.prepare("select status, error from sync_runs where source_id = 'ifind-notice'").get() as { status: string; error: string };
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/未配置/);
  });

  it("reports no-tickers error when configured but no sync codes exist", async () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    // Seed data only has DEMO-* codes, no real tickers
    registerProviders(db);
    const result = await syncSource("ifind-notice", db, { analyze: false });
    expect(result.status).toBe("failed");
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/没有可同步的真实标的/)]));
  });

  it("deduplicates on repeat sync", async () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    process.env.SYNC_CODES = "300308.SZ";

    // Monkey-patch the provider's fetch to return fake data
    const original = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    const originalFetch = original.fetch;
    original.fetch = async () => [
      { title: "Test Notice", body: "This is a test notice body for sync dedup testing.", providerId: "ifind:notice:Test Notice", publishedAt: "2026-10-20" },
    ];

    try {
      registerProviders(db);
      const r1 = await syncSource("ifind-notice", db, { analyze: false });
      expect(r1.added).toBe(1);
      expect(r1.duplicates).toBe(0);

      const r2 = await syncSource("ifind-notice", db, { analyze: false });
      expect(r2.added).toBe(0);
      expect(r2.duplicates).toBe(1);
    } finally {
      original.fetch = originalFetch;
    }
  });

  it("keeps old data on upstream fetch error", async () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    process.env.SYNC_CODES = "300308.SZ";

    const original = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    const originalFetch = original.fetch;

    // First sync succeeds
    original.fetch = async () => [
      { title: "Earlier Notice", body: "Earlier notice body content for retention test.", providerId: "ifind:notice:Earlier Notice", publishedAt: "2026-10-18" },
    ];

    try {
      registerProviders(db);
      const r1 = await syncSource("ifind-notice", db, { analyze: false });
      expect(r1.added).toBe(1);

      // Second sync fails
      original.fetch = async () => { throw new Error("upstream timeout"); };
      const r2 = await syncSource("ifind-notice", db, { analyze: false });
      expect(r2.errors).toHaveLength(1);
      expect(r2.errors[0]).toMatch(/timeout/);

      // Old document still exists
      const doc = db.prepare("select title from documents where canonical_key = 'ifind:notice:Earlier Notice'").get() as { title: string } | undefined;
      expect(doc).toBeDefined();
      expect(doc!.title).toBe("Earlier Notice");

      // sync_runs records the failure
      const runs = db.prepare("select status, error from sync_runs where source_id = 'ifind-notice' order by started_at desc, rowid desc").all() as { status: string; error: string | null }[];
      // All codes failed with 0 added => status is "failed"
      expect(runs[0].status).toBe("failed");
      expect(runs[0].error).toMatch(/timeout/);
    } finally {
      original.fetch = originalFetch;
    }
  });


  it("analyzes existing pending versions within budget", async () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    process.env.SYNC_CODES = "300308.SZ";

    const original = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    const originalFetch = original.fetch;

    // First sync adds 3 items but analyze is off, so all stay pending
    original.fetch = async () => [
      { title: "Pending A", body: "Body of pending notice A for analysis test.", providerId: "ifind:notice:Pending A", publishedAt: "2026-10-20" },
      { title: "Pending B", body: "Body of pending notice B for analysis test.", providerId: "ifind:notice:Pending B", publishedAt: "2026-10-21" },
      { title: "Pending C", body: "Body of pending notice C for analysis test.", providerId: "ifind:notice:Pending C", publishedAt: "2026-10-22" },
    ];

    try {
      registerProviders(db);
      await syncSource("ifind-notice", db, { analyze: false });
      const pending = db.prepare("select count(*) as n from document_versions where analysis_status = 'pending'").get() as { n: number };
      expect(pending.n).toBe(3);

      // Second sync: same items are duplicates, but pending versions should be attempted.
      // Without AI env vars, analysis fails, but the point is they are no longer pending.
      const r2 = await syncSource("ifind-notice", db);
      expect(r2.duplicates).toBe(3);
      expect(r2.added).toBe(0);
      const stillPending = db.prepare("select count(*) as n from document_versions where analysis_status = 'pending'").get() as { n: number };
      // All 3 pending versions should have been attempted (now failed due to no AI config)
      expect(stillPending.n).toBe(0);
      const attempted = db.prepare("select count(*) as n from document_versions where analysis_status = 'failed'").get() as { n: number };
      expect(attempted.n).toBe(3);
    } finally {
      original.fetch = originalFetch;
    }
  });

  it("does not auto-retry failed versions during sync", async () => {
    process.env.IFIND_TOKEN = "test";
    process.env.IFIND_MCP_URL = "https://example.com";
    process.env.SYNC_CODES = "300308.SZ";

    const original = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    const originalFetch = original.fetch;

    original.fetch = async () => [
      { title: "Will Fail", body: "Body of a notice that will fail analysis.", providerId: "ifind:notice:Will Fail", publishedAt: "2026-10-20" },
    ];

    try {
      registerProviders(db);
      // First sync adds and tries to analyze; mark it as failed manually
      await syncSource("ifind-notice", db, { analyze: false });
      db.prepare("update document_versions set analysis_status = 'failed', analysis_error = 'AI_UPSTREAM' where analysis_status = 'pending'").run();

      // Second sync: item is duplicate, failed version should NOT be retried
      const r2 = await syncSource("ifind-notice", db);
      expect(r2.analyzed).toBe(0);
      const failed = db.prepare("select count(*) as n from document_versions where analysis_status = 'failed'").get() as { n: number };
      expect(failed.n).toBe(1); // still failed, not retried
    } finally {
      original.fetch = originalFetch;
    }
  });

  it("throws on unknown source id", async () => {
    await expect(syncSource("nonexistent", db)).rejects.toThrow(/unknown source/);
  });
});

describe("acquireLock", () => {
  const lockFile = join(tmpdir(), `test-sync-lock-${process.pid}.lock`);

  afterEach(() => {
    try { unlinkSync(lockFile); } catch {}
  });

  it("acquires and releases a lock", () => {
    const release = acquireLock(lockFile);
    expect(release).not.toBeNull();
    // Second acquire should fail
    expect(acquireLock(lockFile)).toBeNull();
    release!();
    // After release, acquire should work again
    const r2 = acquireLock(lockFile);
    expect(r2).not.toBeNull();
    r2!();
  });
});

describe("lockedSync", () => {
  it("returns busy status when lock is held", async () => {
    // Use a known lock path by setting DATABASE_PATH
    const lockFile = join(tmpdir(), `test-db-${process.pid}.db.sync.lock`);
    process.env.DATABASE_PATH = join(tmpdir(), `test-db-${process.pid}.db`);
    // Manually create the lock file
    const { writeFileSync: wf } = await import("node:fs");
    wf(lockFile, "");
    try {
      registerProviders(db);
      const results = await lockedSync(["ifind-notice"], db);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("busy");
      expect(results[0].sourceId).toBe("ifind-notice");
    } finally {
      try { unlinkSync(lockFile); } catch {}
      delete process.env.DATABASE_PATH;
    }
  });
});
