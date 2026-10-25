import { byWeight, independentOrigins, isSubstantive } from "./evidence";
import { formatTime } from "./time";
import { CATEGORY_LABEL, STATUS_LABEL } from "./types";
import type { ConclusionDraft, ConflictCard, EvidenceItem, Status, SummaryLine } from "./types";

/**
 * Evidence visible at `asOf`: fetched and linked no later than asOf, and not yet revoked.
 * Late back-filled documents therefore never leak into earlier conclusions.
 */
export function visibleAt(items: EvidenceItem[], asOf: string): EvidenceItem[] {
  return items.filter(
    (i) => i.fetchedAt <= asOf && i.createdAt <= asOf && (i.revokedAt === null || i.revokedAt > asOf),
  );
}

type PropState = { prop: EvidenceItem; status: Exclude<Status, "expired">; supports: EvidenceItem[]; refutes: EvidenceItem[] };

/** Pure rule engine. Status comes from rules only; summary is a template where every line cites evidence ids. */
export function computeConclusion(all: EvidenceItem[], asOf: string): ConclusionDraft {
  const items = visibleAt(all, asOf);
  const supersededIds = new Set(
    items.filter((i) => (i.relation === "corrects" || i.relation === "supersedes") && i.targetClaimId).map((i) => i.targetClaimId!),
  );
  const isExpired = (i: EvidenceItem) => i.validUntil !== null && i.validUntil <= asOf;

  // Propositions: claims asserted about the event (not refutations, not attached to another claim as support).
  const asserted = items.filter((i) => i.relation !== "refutes" && !(i.relation === "supports" && i.targetClaimId));
  const replaced = asserted.filter((i) => supersededIds.has(i.claimId));
  const expired = asserted.filter((i) => !supersededIds.has(i.claimId) && isExpired(i));
  const active = asserted.filter((i) => !supersededIds.has(i.claimId) && !isExpired(i));

  const states: PropState[] = active.map((prop) => {
    const supports = [prop, ...items.filter((i) => i.relation === "supports" && i.targetClaimId === prop.claimId)];
    const refutes = items.filter((i) => i.relation === "refutes" && i.targetClaimId === prop.claimId && !isExpired(i));
    const subSupport = supports.some(isSubstantive);
    const subRefute = refutes.some(isSubstantive);
    let status: PropState["status"];
    if (refutes.length === 0) status = subSupport ? "supported" : "unverified";
    else if (subRefute && !subSupport) status = "denied";
    else status = "conflicted"; // never let tier alone erase a counter-claim
    return { prop, status, supports, refutes };
  });

  const has = (s: Status) => states.some((p) => p.status === s);
  // An explicit validity window that lapsed with no substantive news afterwards ends the event's current state.
  const lastExpiry = expired.reduce<string | null>((m, e) => (m === null || e.validUntil! > m ? e.validUntil! : m), null);
  const lapsed =
    lastExpiry !== null && !items.some((i) => i.fetchedAt > lastExpiry && isSubstantive(i) && !supersededIds.has(i.claimId));
  let status: Status;
  if (has("conflicted")) status = "conflicted";
  else if (lapsed) status = "expired";
  else if (has("supported")) status = "supported";
  else if (has("unverified")) status = "unverified";
  else if (has("denied")) status = "denied";
  else status = "unverified";

  const conflicts: ConflictCard[] = states
    .filter((p) => p.status === "conflicted")
    .map((p) => ({ targetClaimId: p.prop.claimId, supportIds: p.supports.map((s) => s.id), refuteIds: p.refutes.map((r) => r.id) }));

  const summary: SummaryLine[] = [];
  const missing: string[] = [];
  for (const p of [...states].sort((a, b) => byWeight(a.prop, b.prop))) {
    const src = `${p.prop.sourceName}（${CATEGORY_LABEL[p.prop.category]}）`;
    if (p.status === "supported") {
      summary.push({ text: `${src}：${p.prop.content}`, evidenceIds: p.supports.filter(isSubstantive).map((s) => s.id) });
    } else if (p.status === "unverified") {
      const n = independentOrigins(p.supports);
      summary.push({ text: `待核实：${p.prop.content}（独立来源 ${n} 个，均非可追溯事实）`, evidenceIds: p.supports.map((s) => s.id) });
      missing.push(`“${p.prop.content}”缺少当事方公告或监管披露`);
    } else if (p.status === "denied") {
      const r = p.refutes.filter(isSubstantive);
      summary.push({ text: `已被否认：${p.prop.content}；${r.map((x) => `${x.sourceName}称“${x.content}”`).join("；")}`, evidenceIds: [p.prop.id, ...r.map((x) => x.id)] });
    } else {
      summary.push({ text: `存在冲突：${p.prop.content}；反方：${p.refutes.map((x) => `${x.sourceName}称“${x.content}”`).join("；")}`, evidenceIds: [...p.supports, ...p.refutes].map((x) => x.id) });
      missing.push(`“${p.prop.content}”双方说法尚无更高等级来源裁定`);
    }
  }
  for (const e of expired) {
    summary.push({ text: `已失效：${e.content}（有效期至 ${formatTime(e.validUntil)}，北京时间）`, evidenceIds: [e.id] });
  }
  if (items.length === 0) missing.push("尚无任何关联证据");

  const effective = new Set<string>();
  for (const p of states) for (const x of [...p.supports, ...p.refutes]) effective.add(x.id);

  return {
    status,
    summary,
    evidenceIds: [...effective].sort(),
    supersededIds: replaced.map((r) => r.id).sort(),
    expiredIds: expired.map((e) => e.id).sort(),
    conflicts,
    missing,
  };
}

/** Two drafts are the same conclusion when status and the evidence partition are unchanged. */
export const signature = (d: Pick<ConclusionDraft, "status" | "evidenceIds" | "supersededIds" | "expiredIds">) =>
  JSON.stringify([d.status, d.evidenceIds, d.supersededIds, d.expiredIds]);

/** Human-readable reason, naming the evidence that triggered the change. */
export function describeChange(
  prev: Pick<ConclusionDraft, "status" | "evidenceIds" | "expiredIds" | "supersededIds"> | null,
  next: ConclusionDraft,
  label: (evidenceId: string) => string,
): string {
  if (!prev) return `首次生成结论：${STATUS_LABEL[next.status]}`;
  const parts: string[] = [];
  const added = next.evidenceIds.filter((id) => !prev.evidenceIds.includes(id) && !prev.supersededIds.includes(id));
  const removed = prev.evidenceIds.filter((id) => !next.evidenceIds.includes(id) && !next.supersededIds.includes(id) && !next.expiredIds.includes(id));
  const newlySuperseded = next.supersededIds.filter((id) => !prev.supersededIds.includes(id));
  const newlyExpired = next.expiredIds.filter((id) => !prev.expiredIds.includes(id));
  if (added.length) parts.push(`新增证据：${added.map(label).join("、")}`);
  if (newlySuperseded.length) parts.push(`被更正/替代：${newlySuperseded.map(label).join("、")}`);
  if (newlyExpired.length) parts.push(`到期失效：${newlyExpired.map(label).join("、")}`);
  if (removed.length) parts.push(`移除或撤销：${removed.map(label).join("、")}`);
  const head = prev.status === next.status ? `状态保持${STATUS_LABEL[next.status]}` : `${STATUS_LABEL[prev.status]} → ${STATUS_LABEL[next.status]}`;
  return parts.length ? `${head}；${parts.join("；")}` : head;
}
