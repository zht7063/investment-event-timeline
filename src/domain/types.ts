import { z } from "zod";

export const Category = z.enum(["fact", "opinion", "speculation", "rumor"]);
export type Category = z.infer<typeof Category>;

export const Relation = z.enum(["supports", "refutes", "corrects", "supersedes"]);
export type Relation = z.infer<typeof Relation>;

export const Status = z.enum(["unverified", "supported", "conflicted", "denied", "expired"]);
export type Status = z.infer<typeof Status>;

export const Precision = z.enum(["datetime", "day", "month", "quarter", "year"]);
export type Precision = z.infer<typeof Precision>;

export const SourceKind = z.enum(["regulator", "issuer", "media", "research", "rumor", "market_data", "manual"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const CATEGORY_LABEL: Record<Category, string> = {
  fact: "事实陈述",
  opinion: "观点",
  speculation: "推测",
  rumor: "传闻",
};

export const STATUS_LABEL: Record<Status, string> = {
  unverified: "待核实",
  supported: "已有证据支持",
  conflicted: "存在冲突",
  denied: "已被否认",
  expired: "已失效",
};

export const RELATION_LABEL: Record<Relation, string> = {
  supports: "支持",
  refutes: "反驳",
  corrects: "更正",
  supersedes: "替代",
};

/** Tier 1 = regulator/exchange, 2 = issuer, 3 = traceable media, 4 = research/commentary, 5 = anonymous rumor. */
export const TIER_LABEL: Record<number, string> = {
  1: "监管/交易所披露",
  2: "当事方公告",
  3: "可追溯媒体原始报道",
  4: "研报或评论",
  5: "匿名传闻",
};

/** One evidence link as seen by the conclusion engine (claim + document + source joined). */
export type EvidenceItem = {
  id: string; // event_evidence.id
  claimId: string;
  relation: Relation;
  targetClaimId: string | null;
  reason: string;
  createdAt: string;
  revokedAt: string | null;
  category: Category;
  content: string;
  quote: string;
  tier: number;
  sourceName: string;
  documentId: string;
  rootDocumentId: string; // end of the repost chain
  publishedAt: string | null;
  fetchedAt: string;
  validUntil: string | null;
};

export type SummaryLine = { text: string; evidenceIds: string[] };

export type ConflictCard = {
  targetClaimId: string;
  supportIds: string[];
  refuteIds: string[];
};

export type ConclusionDraft = {
  status: Status;
  summary: SummaryLine[];
  evidenceIds: string[]; // effective evidence, sorted
  supersededIds: string[];
  expiredIds: string[];
  conflicts: ConflictCard[];
  missing: string[];
};
