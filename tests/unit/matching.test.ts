import { describe, expect, it } from "vitest";
import { canonicalKey, contentHash, decideIngest, rankCandidates, scoreCandidate } from "@/domain/matching";

describe("dedupe", () => {
  it("normalizes URLs: tracking params, fragment, trailing slash, host case", () => {
    expect(canonicalKey({ url: "https://News.Example/a/1/?utm_source=x&b=2&a=1#top" })).toBe("https://news.example/a/1?a=1&b=2");
    expect(canonicalKey({ url: "https://x.example/p", providerId: "ifind:1" })).toBe("ifind:1");
    expect(canonicalKey({ url: "not a url" })).toBeNull();
  });

  it("same content is a duplicate, changed content is a new version", () => {
    const h = contentHash("公司 拟回购");
    expect(contentHash("公司  拟回购\n")).toBe(h);
    expect(decideIngest(null, h)).toBe("new_document");
    expect(decideIngest({ hashes: [h] }, h)).toBe("duplicate");
    expect(decideIngest({ hashes: [h] }, contentHash("公司拟回购，已完成"))).toBe("new_version");
  });
});

describe("event candidates", () => {
  const acq = { id: "acq", subjectCode: "A", eventType: "acquisition", matterKey: "acq:星河", anchorDate: "2026-03-05T00:00:00Z" };
  const div = { id: "div", subjectCode: "A", eventType: "dividend", matterKey: "div:2025", anchorDate: "2026-03-28T00:00:00Z" };
  const other = { id: "other", subjectCode: "M", eventType: "acquisition", matterKey: "acq:星河", anchorDate: "2026-03-05T00:00:00Z" };

  it("auto-links only on identical subject and matter key", () => {
    const c = scoreCandidate({ subjectCode: "A", eventType: "acquisition", matterKey: "acq:星河", date: null }, acq);
    expect(c.autoLink).toBe(true);
  });

  it("same company alone never becomes a candidate", () => {
    const f = { subjectCode: "A", eventType: "buyback", matterKey: "buyback:2026", date: "2026-09-01T00:00:00Z" };
    expect(rankCandidates(f, [acq, div])).toEqual([]);
  });

  it("different company with the same project name is never matched", () => {
    const f = { subjectCode: "A", eventType: "acquisition", matterKey: "acq:星河", date: null };
    expect(rankCandidates(f, [other])).toEqual([]);
  });

  it("same type within the window is a candidate that needs confirmation", () => {
    const f = { subjectCode: "A", eventType: "acquisition", matterKey: null, date: "2026-03-20T00:00:00Z" };
    const [c] = rankCandidates(f, [acq, div]);
    expect(c).toMatchObject({ eventId: "acq", autoLink: false });
  });
});
