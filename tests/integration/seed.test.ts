import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "@/server/db";
import { conclusionHistory, loadEvidence, recompute } from "@/server/repo";
import { resetToSeed } from "@/server/seed";

let db: DatabaseSync;
const NOW = "2026-10-25T00:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  resetToSeed(db, NOW);
});

describe("seeded acquisition chain", () => {
  it("walks rumor → announcement → conflict → correction → denial → expiry", () => {
    const h = conclusionHistory("evt-acq", db);
    // One version per change of effective evidence: rumor, repost, announcement, seller objection,
    // correction, denial, back-filled research, expiry.
    expect(h.map((c) => c.status)).toEqual([
      "unverified", "unverified", "supported", "conflicted", "supported", "supported", "supported", "expired",
    ]);
    expect(h.every((c, i) => c.previous_id === (i ? h[i - 1].id : null))).toBe(true);
    expect(h[3].change_reason).toMatch(/已有证据支持 → 存在冲突/);
    expect(h[4].change_reason).toMatch(/被更正\/替代/);
    expect(h.at(-1)!.change_reason).toMatch(/到期失效/);
  });

  it("the denial is recorded against the 100% rumor without erasing it", () => {
    const afterDenial = conclusionHistory("evt-acq", db).find((c) => c.generated_at === "2026-03-15T11:20:00.000Z")!;
    const lines = JSON.parse(afterDenial.summary) as { text: string; evidenceIds: string[] }[];
    const denied = lines.find((s) => s.text.startsWith("已被否认"))!;
    expect(denied.text).toMatch(/100%/);
    expect(denied.evidenceIds).toEqual(["evt-acq:e1", "evt-acq:e10"]);
    // The correction-based 51% claim is still supported, so the event as a whole is not "denied".
    expect(afterDenial.status).toBe("supported");
  });

  it("recomputing with unchanged evidence adds no version", () => {
    const before = conclusionHistory("evt-acq", db).length;
    expect(recompute("evt-acq", NOW, db).changed).toBe(false);
    expect(conclusionHistory("evt-acq", db).length).toBe(before);
  });

  it("the late back-filled research note does not appear before it was fetched", () => {
    const research = loadEvidence("evt-acq", db).find((i) => i.claimId === "c-research")!;
    expect(research.publishedAt! < research.fetchedAt).toBe(true);
    const early = conclusionHistory("evt-acq", db).filter((c) => c.generated_at < research.fetchedAt);
    expect(early.every((c) => !JSON.parse(c.evidence_ids).includes(research.id))).toBe(true);
  });

  it("reposted rumor collapses to the original forum post", () => {
    const items = loadEvidence("evt-acq", db);
    expect(items.find((i) => i.claimId === "c-news-rumor")!.rootDocumentId).toBe("doc-rumor");
  });

  it("same-company and same-name distractor events stay separate and supported", () => {
    expect(conclusionHistory("evt-div", db).map((c) => c.status)).toEqual(["supported"]);
    expect(conclusionHistory("evt-park", db).map((c) => c.status)).toEqual(["supported"]);
    expect(loadEvidence("evt-park", db).map((i) => i.claimId)).toEqual(["c-other-co"]);
  });

  it("reset is idempotent", () => {
    const before = conclusionHistory("evt-acq", db).map((c) => c.status);
    resetToSeed(db, NOW);
    expect(conclusionHistory("evt-acq", db).map((c) => c.status)).toEqual(before);
  });
});
