import type { EvidenceItem, SourceKind } from "./types";

export const DEFAULT_TIER: Record<SourceKind, number> = {
  regulator: 1,
  issuer: 2,
  media: 3,
  research: 4,
  rumor: 5,
  market_data: 4,
  manual: 4,
};

/** Substantive = a factual claim from a traceable source (tier <= 3). Opinions and rumors never are. */
export const isSubstantive = (e: Pick<EvidenceItem, "category" | "tier">) => e.category === "fact" && e.tier <= 3;

/** Follow reposted_from links to the earliest traceable document. Cycles and breaks stop the walk. */
export function rootOf(docId: string, repostedFrom: Map<string, string | null>): { rootId: string; chainBroken: boolean } {
  const seen = new Set<string>();
  let cur = docId;
  while (!seen.has(cur)) {
    seen.add(cur);
    if (!repostedFrom.has(cur)) return { rootId: cur, chainBroken: true };
    const next = repostedFrom.get(cur);
    if (!next) return { rootId: cur, chainBroken: false };
    cur = next;
  }
  return { rootId: cur, chainBroken: true };
}

/** Reposts collapse into their root: count independent origins, not copies. */
export const independentOrigins = (items: Pick<EvidenceItem, "rootDocumentId">[]) =>
  new Set(items.map((i) => i.rootDocumentId)).size;

/** Display order: stronger tier first, then substantive, then earlier disclosure. Ranking only, not probability. */
export function byWeight(a: EvidenceItem, b: EvidenceItem): number {
  return (
    a.tier - b.tier ||
    Number(isSubstantive(b)) - Number(isSubstantive(a)) ||
    (a.publishedAt ?? "9").localeCompare(b.publishedAt ?? "9")
  );
}
