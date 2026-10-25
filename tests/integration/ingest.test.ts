import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AiError, checkExtraction, type Extractor } from "@/server/ai";
import { openDb } from "@/server/db";
import { addManualClaim, analyzeVersion, associate, importDocument, revoke } from "@/server/ingest";
import { conclusionHistory, getEventDetail } from "@/server/repo";
import { resetToSeed } from "@/server/seed";

let db: DatabaseSync;
const T0 = "2026-10-25T00:00:00.000Z";
const body = "示例光电今日公告：公司与星河半导体股东签署的收购意向协议已提前终止，公司终止筹划本次收购。";
const fixture = JSON.stringify({
  event: { title: "示例光电收购星河半导体", subjectCode: "DEMO-A", eventType: "acquisition", matterKey: "acq:星河半导体" },
  claims: [
    { quote: "公司终止筹划本次收购", category: "fact", content: "公司终止筹划收购星河半导体" },
    { quote: "已完成交割", category: "fact", content: "伪造引用" },
  ],
});
const fixed: Extractor = async ({ body: b }) => checkExtraction(b, fixture);

beforeEach(() => {
  db = openDb(":memory:");
  resetToSeed(db, T0);
});

const doImport = (over: Partial<Parameters<typeof importDocument>[0]> = {}, at = T0) =>
  importDocument({ source: { id: "src-issuer-a" }, title: "终止公告", body, url: "https://issuer.example/ann/9?utm_source=x", publishedAt: "2026-10-24 18:00", ...over }, db, at);

describe("import", () => {
  it("dedupes by canonical key and content hash; changed content is a new version", () => {
    const a = doImport();
    expect(a.decision).toBe("new_document");
    expect(doImport({ url: "https://issuer.example/ann/9" }).decision).toBe("duplicate");
    const b = doImport({ url: "https://issuer.example/ann/9", body: `${body}特此公告。` }, "2026-10-25T01:00:00.000Z");
    expect(b).toMatchObject({ decision: "new_version", documentId: a.documentId });
    const v = db.prepare("select previous_version_id, fetched_at, published_precision from document_versions where id = ?").get(b.versionId) as Record<string, string>;
    expect(v.previous_version_id).toBe(a.versionId);
    expect(v.fetched_at).toBe("2026-10-25T01:00:00.000Z");
    expect(v.published_precision).toBe("datetime");
  });

  it("rejects empty bodies and keeps unknown publish time unknown", () => {
    expect(() => doImport({ body: "   " })).toThrow(/正文为空/);
    const r = doImport({ publishedAt: "", url: null });
    expect((db.prepare("select published_at from document_versions where id = ?").get(r.versionId) as { published_at: null }).published_at).toBeNull();
  });
});

describe("analyze → associate → revoke", () => {
  it("stores only verbatim claims, proposes the matching event, and recomputes on link and revoke", async () => {
    const { versionId } = doImport();
    const r = await analyzeVersion(versionId, fixed, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analysis.rejected).toHaveLength(1);
    expect(r.analysis.candidates[0]).toMatchObject({ eventId: "evt-acq", autoLink: true });
    // Same company, different matter must not be proposed above threshold as the dividend event.
    expect(r.analysis.candidates.find((c) => c.eventId === "evt-div")).toBeUndefined();
    const claim = db.prepare("select id from claims where version_id = ?").get(versionId) as { id: string };

    const before = conclusionHistory("evt-acq", db).length;
    const link = associate({ eventId: "evt-acq", links: [{ claimId: claim.id, relation: "refutes", targetClaimId: "c-ann-51", reason: "终止公告" }] }, db, "2026-10-25T02:00:00.000Z");
    expect(link.conclusionChanged).toBe(true);
    expect(conclusionHistory("evt-acq", db)).toHaveLength(before + 1);

    revoke(link.evidenceIds[0], db, "2026-10-25T03:00:00.000Z");
    const h = conclusionHistory("evt-acq", db);
    expect(h).toHaveLength(before + 2);
    expect(h.at(-1)!.change_reason).toMatch(/移除或撤销/);
    expect((db.prepare("select revoked_at from event_evidence where id = ?").get(link.evidenceIds[0]) as { revoked_at: string }).revoked_at).toBeTruthy();
    expect(() => revoke(link.evidenceIds[0], db)).toThrow(/已撤销/);
  });

  it("model failure keeps the document as failed and retryable", async () => {
    const { versionId } = doImport();
    const r = await analyzeVersion(versionId, async () => { throw new AiError("AI_UPSTREAM", "RATE_LIMITED：上游限流"); }, db);
    expect(r).toMatchObject({ ok: false, code: "AI_UPSTREAM" });
    expect(db.prepare("select analysis_status from document_versions where id = ?").get(versionId)).toEqual({ analysis_status: "failed" });
    expect((await analyzeVersion(versionId, fixed, db)).ok).toBe(true);
  });

  it("manual claims use the same verbatim check; relations need a target in the event", () => {
    const { versionId } = doImport();
    expect(() => addManualClaim(versionId, { quote: "不存在的话", category: "fact", content: "x" }, db)).toThrow(/非逐字/);
    const id = addManualClaim(versionId, { quote: "公司终止筹划本次收购", category: "fact", content: "终止" }, db);
    expect(() => associate({ eventId: "evt-acq", links: [{ claimId: id, relation: "refutes", reason: "x" }] }, db)).toThrow(/目标论断/);
    expect(() => associate({ eventId: "evt-acq", links: [{ claimId: id, relation: "refutes", targetClaimId: "c-dividend", reason: "x" }] }, db)).toThrow(/目标论断/);
    expect(() => associate({ newEvent: { title: "x", eventType: "acquisition", subjectCode: "DEMO-A", matterKey: "acq:星河半导体" }, links: [{ claimId: id, relation: "supports", reason: "x" }] }, db)).toThrow(/相同事项/);
    const ne = associate({ newEvent: { title: "示例光电终止事项", eventType: "other", subjectCode: "DEMO-A", matterKey: "other:终止" }, links: [{ claimId: id, relation: "supports", reason: "当事方公告" }] }, db, T0);
    expect(getEventDetail(ne.eventId, null, db)!.conclusion.status).toBe("supported");
  });
});

describe("as-of view", () => {
  it("does not read evidence fetched after asOf and does not write history", () => {
    const len = conclusionHistory("evt-acq", db).length;
    const early = getEventDetail("evt-acq", "2026-03-06T00:00:00.000Z", db)!;
    expect(early.isHistorical).toBe(true);
    expect(early.conclusion.status).toBe("supported");
    expect(early.conclusion.evidenceIds).not.toContain("evt-acq:e6");
    expect(early.history.every((h) => h.generated_at <= early.asOf)).toBe(true);
    expect(conclusionHistory("evt-acq", db)).toHaveLength(len);
    expect(getEventDetail("evt-acq", null, db)!.conclusion.status).toBe("expired");
  });
});
