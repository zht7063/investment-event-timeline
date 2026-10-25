import { createHash } from "node:crypto";

export function contentHash(body: string): string {
  // Whitespace-only edits are not new versions.
  return createHash("sha256").update(body.replace(/\s+/g, " ").trim()).digest("hex");
}

/** Same canonical key = same document. Provider ids win over URLs. */
export function canonicalKey(input: { url?: string | null; providerId?: string | null }): string | null {
  if (input.providerId) return input.providerId;
  if (!input.url) return null;
  let u: URL;
  try {
    u = new URL(input.url.trim());
  } catch {
    return null;
  }
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|spm$|from$)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
}

export type IngestDecision = "new_document" | "new_version" | "duplicate";

export function decideIngest(existing: { hashes: string[] } | null, hash: string): IngestDecision {
  if (!existing) return "new_document";
  return existing.hashes.includes(hash) ? "duplicate" : "new_version";
}

export type EventFeatures = { subjectCode: string; eventType: string; matterKey: string | null; date: string | null };
export type CandidateEvent = { id: string; subjectCode: string; eventType: string; matterKey: string; anchorDate: string | null };
export type CandidateScore = { eventId: string; score: number; autoLink: boolean; reasons: string[] };

const WINDOW_MS = 90 * 24 * 3600 * 1000;

/**
 * Rule-based recall. Same company alone never merges: it scores below the candidate threshold.
 * Only an identical matter key auto-links; everything else needs user confirmation.
 */
export function scoreCandidate(f: EventFeatures, e: CandidateEvent): CandidateScore {
  const reasons: string[] = [];
  if (f.subjectCode !== e.subjectCode) return { eventId: e.id, score: 0, autoLink: false, reasons: ["主体标的不同"] };
  let score = 0.2;
  reasons.push("主体标的相同");
  if (f.matterKey && f.matterKey === e.matterKey) {
    return { eventId: e.id, score: 1, autoLink: true, reasons: [...reasons, "事项标识一致"] };
  }
  if (f.eventType === e.eventType) {
    score += 0.3;
    reasons.push("事件类型相同");
  }
  if (f.date && e.anchorDate && Math.abs(Date.parse(f.date) - Date.parse(e.anchorDate)) <= WINDOW_MS) {
    score += 0.2;
    reasons.push("时间窗口内（90 天）");
  }
  return { eventId: e.id, score: Math.round(score * 100) / 100, autoLink: false, reasons };
}

export const CANDIDATE_THRESHOLD = 0.5;

export function rankCandidates(f: EventFeatures, events: CandidateEvent[]): CandidateScore[] {
  return events
    .map((e) => scoreCandidate(f, e))
    .filter((c) => c.score >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}
