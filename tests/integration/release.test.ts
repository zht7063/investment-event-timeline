import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDb, setDb } from "@/server/db";
import { resetToSeed } from "@/server/seed";
import { importDocument } from "@/server/ingest";
import { POST } from "@/app/api/sources/analyze-pending/route";
import { GET as prices } from "@/app/api/prices/route";
import { PROVIDERS, registerProviders, syncSource } from "@/server/sources/sync";
import { listPendingDocuments } from "@/server/repo";

vi.mock("@/server/ai", async (load) => ({
  ...await load<typeof import("@/server/ai")>(),
  modelExtractor: vi.fn(async ({ body, subjectHint }) => ({
    event: { title: "Test event", subjectCode: subjectHint, eventType: "other", matterKey: "release-test" },
    claims: [{ quote: body, quoteStart: 0, content: body, category: "fact" }],
    rejected: [],
  })),
}));
vi.mock("@/server/sources/fuyao", () => ({
  isConfigured: vi.fn(() => true),
  getPriceSnapshot: vi.fn(async () => []),
}));

import { modelExtractor } from "@/server/ai";
import { getPriceSnapshot, isConfigured } from "@/server/sources/fuyao";

let db: DatabaseSync;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_TOKEN", "test-admin");
  vi.stubEnv("IFIND_TOKEN", "test");
  vi.stubEnv("IFIND_MCP_URL", "https://example.invalid");
  vi.stubEnv("SYNC_CODES", "300308.SZ");
  db = openDb(":memory:");
  setDb(db);
  resetToSeed(db);
  registerProviders(db);
});
afterEach(() => {
  setDb(undefined);
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const add = (n: number) => importDocument({
  source: { id: "ifind-notice" }, title: `Notice ${n}`,
  body: `Notice body ${n}`, providerId: `release:${n}`,
}, db);
const request = (body = "{}", token = "test-admin") => new Request("http://localhost/api/sources/analyze-pending", {
  method: "POST", headers: { authorization: `Bearer ${token}` }, body,
});

describe("pending analysis API", () => {
  it("rejects unauthorized calls before invoking the model", async () => {
    add(1);
    expect((await POST(request("{}", ""))).status).toBe(401);
    expect(modelExtractor).not.toHaveBeenCalled();
  });
  it("rejects malformed input rather than silently starting a batch", async () => {
    add(1);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request('{"versionId":123}'))).status).toBe(400);
    expect(modelExtractor).not.toHaveBeenCalled();
  });
  it("caps batches at 20 and leaves remaining versions pending", async () => {
    for (let i = 0; i < 22; i++) add(i);
    const res = await POST(request());
    expect(await res.json()).toMatchObject({ analyzed: 20, failed: 0, total: 20 });
    expect(modelExtractor).toHaveBeenCalledTimes(20);
    expect(db.prepare("select count(*) n from document_versions where analysis_status='pending'").get()).toMatchObject({ n: 2 });
  });
  it("retries failed versions once and skips already analyzed versions", async () => {
    const doc = add(1);
    db.prepare("update document_versions set analysis_status='failed' where id=?").run(doc.versionId);
    const body = JSON.stringify({ versionId: doc.versionId });
    expect(await (await POST(request(body))).json()).toMatchObject({ analyzed: 1, failed: 0 });
    expect(await (await POST(request(body))).json()).toMatchObject({ analyzed: 0 });
    expect(modelExtractor).toHaveBeenCalledTimes(1);
    expect(listPendingDocuments(db).some((d) => d.id === doc.documentId && d.analysis_status === "done")).toBe(true);
  });
});

describe("sync backlog", () => {
  it("processes older pending versions before fresh arrivals within the 10-call budget", async () => {
    const old = add(100);
    const provider = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    vi.spyOn(provider, "fetch").mockResolvedValue(Array.from({ length: 10 }, (_, n) => ({
      title: `Fresh ${n}`, body: `Fresh body ${n}`, providerId: `fresh:${n}`,
    })));
    expect((await syncSource(provider.id, db)).analyzed).toBe(10);
    expect(db.prepare("select analysis_status from document_versions where id=?").get(old.versionId)).toMatchObject({ analysis_status: "done" });
    expect(modelExtractor).toHaveBeenCalledTimes(10);
  });
  it("retains ticker hints when analysis is deferred to a later sync", async () => {
    const provider = PROVIDERS.find((p) => p.id === "ifind-notice")!;
    vi.spyOn(provider, "fetch").mockResolvedValue([{ title: "Deferred", body: "Deferred body", providerId: "deferred" }]);
    await syncSource(provider.id, db, { analyze: false });
    await syncSource(provider.id, db);
    expect(modelExtractor).toHaveBeenCalledWith(expect.objectContaining({ subjectHint: "300308.SZ" }));
  });
});

describe("prices API", () => {
  it("rejects missing and invalid ticker codes", async () => {
    for (const query of ["", "?codes=DEMO-A", "?codes=300308.XX"]) {
      expect((await prices(new Request(`http://localhost/api/prices${query}`))).status).toBe(400);
    }
    expect(getPriceSnapshot).not.toHaveBeenCalled();
  });
  it("reports unavailable configuration without an upstream call", async () => {
    vi.mocked(isConfigured).mockReturnValueOnce(false);
    expect(await (await prices(new Request("http://localhost/api/prices?codes=300308.SZ"))).json()).toEqual({ prices: [], unavailable: true });
    expect(getPriceSnapshot).not.toHaveBeenCalled();
  });
  it("filters unsolicited rows and deduplicates requested codes", async () => {
    const price = { code: "300308.SZ", name: "", lastPrice: 1, changeRatioPct: 0, turnover: 1, timestamp: null };
    vi.mocked(getPriceSnapshot).mockResolvedValueOnce([price, { ...price, code: "600519.SH" }]);
    const res = await prices(new Request("http://localhost/api/prices?codes=300308.SZ,300308.SZ"));
    expect(await res.json()).toEqual({ prices: [price], unavailable: false });
    expect(getPriceSnapshot).toHaveBeenCalledWith(["300308.SZ"]);
  });
});
