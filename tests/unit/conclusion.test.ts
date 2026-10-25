import { describe, expect, it } from "vitest";
import { computeConclusion, describeChange, visibleAt } from "@/domain/conclusion";
import { independentOrigins, rootOf } from "@/domain/evidence";
import type { EvidenceItem } from "@/domain/types";

let n = 0;
function ev(p: Partial<EvidenceItem>): EvidenceItem {
  n += 1;
  return {
    id: `e${n}`, claimId: `c${n}`, relation: "supports", targetClaimId: null, reason: "", createdAt: "2026-01-01T00:00:00Z",
    revokedAt: null, category: "fact", content: `claim ${n}`, quote: "", tier: 2, sourceName: "src", documentId: `d${n}`,
    rootDocumentId: `d${n}`, publishedAt: "2026-01-01T00:00:00Z", fetchedAt: "2026-01-01T00:00:00Z", validUntil: null, ...p,
  };
}
const NOW = "2026-02-01T00:00:00Z";

describe("conclusion rules", () => {
  it("rumors alone are unverified and list missing evidence", () => {
    const d = computeConclusion([ev({ category: "rumor", tier: 5 })], NOW);
    expect(d.status).toBe("unverified");
    expect(d.missing[0]).toMatch(/缺少/);
  });

  it("an issuer fact supports only its own claim", () => {
    const rumor = ev({ category: "rumor", tier: 5 });
    const fact = ev({});
    const d = computeConclusion([rumor, fact], NOW);
    expect(d.status).toBe("supported");
    expect(d.summary.find((s) => s.text.startsWith("待核实"))).toBeDefined();
  });

  it("support and refutation from substantive sources is a conflict with both sides visible", () => {
    const a = ev({});
    const b = ev({ relation: "refutes", targetClaimId: a.claimId, tier: 3 });
    const d = computeConclusion([a, b], NOW);
    expect(d.status).toBe("conflicted");
    expect(d.conflicts).toEqual([{ targetClaimId: a.claimId, supportIds: [a.id], refuteIds: [b.id] }]);
  });

  it("a substantive denial of an unsupported rumor is denied", () => {
    const r = ev({ category: "rumor", tier: 5 });
    const d = computeConclusion([r, ev({ relation: "refutes", targetClaimId: r.claimId })], NOW);
    expect(d.status).toBe("denied");
  });

  it("an opinion refuting a fact does not create a conflict-free denial", () => {
    const a = ev({ category: "rumor", tier: 5 });
    const d = computeConclusion([a, ev({ relation: "refutes", targetClaimId: a.claimId, category: "opinion", tier: 4 })], NOW);
    expect(d.status).toBe("conflicted");
  });

  it("a correction supersedes the original claim but keeps it on record", () => {
    const a = ev({});
    const fix = ev({ relation: "corrects", targetClaimId: a.claimId });
    const d = computeConclusion([a, fix], NOW);
    expect(d.supersededIds).toEqual([a.id]);
    expect(d.evidenceIds).toEqual([fix.id]);
    expect(d.status).toBe("supported");
  });

  it("an explicit validity window that lapsed without new facts expires the event", () => {
    const a = ev({ validUntil: "2026-01-15T00:00:00Z" });
    expect(computeConclusion([a], "2026-01-10T00:00:00Z").status).toBe("supported");
    const d = computeConclusion([a], NOW);
    expect(d.status).toBe("expired");
    expect(d.expiredIds).toEqual([a.id]);
  });

  it("as-of view ignores evidence fetched or linked later, and revocations after as-of", () => {
    const early = ev({ category: "rumor", tier: 5 });
    const late = ev({ fetchedAt: "2026-03-01T00:00:00Z", createdAt: "2026-03-01T00:00:00Z" });
    const revoked = ev({ revokedAt: "2026-01-20T00:00:00Z" });
    expect(visibleAt([early, late, revoked], "2026-01-10T00:00:00Z").map((i) => i.id)).toEqual([early.id, revoked.id]);
    expect(visibleAt([early, late, revoked], NOW).map((i) => i.id)).toEqual([early.id]);
  });

  it("empty evidence is unverified, never a normal conclusion", () => {
    const d = computeConclusion([], NOW);
    expect(d.status).toBe("unverified");
    expect(d.missing).toContain("尚无任何关联证据");
  });

  it("change reason names status transition and triggering evidence", () => {
    const a = ev({ category: "rumor", tier: 5 });
    const prev = computeConclusion([a], NOW);
    const deny = ev({ relation: "refutes", targetClaimId: a.claimId, content: "公司否认" });
    const next = computeConclusion([a, deny], NOW);
    expect(describeChange(prev, next, (id) => (id === deny.id ? "否认公告" : id))).toBe("待核实 → 已被否认；新增证据：否认公告");
  });
});

describe("source chain", () => {
  it("reposts collapse into one origin", () => {
    const chain = new Map<string, string | null>([["root", null], ["copy1", "root"], ["copy2", "copy1"]]);
    expect(rootOf("copy2", chain)).toEqual({ rootId: "root", chainBroken: false });
    expect(rootOf("orphan", new Map([["orphan", "missing"]]))).toEqual({ rootId: "missing", chainBroken: true });
    expect(independentOrigins([{ rootDocumentId: "root" }, { rootDocumentId: "root" }])).toBe(1);
  });
});
