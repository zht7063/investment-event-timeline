import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_TIER } from "@/domain/evidence";
import { canonicalKey, contentHash, decideIngest, rankCandidates, type CandidateScore, type IngestDecision } from "@/domain/matching";
import { parseTime } from "@/domain/time";
import type { Relation, SourceKind } from "@/domain/types";
import { AiError, modelExtractor, validateClaims, type Extractor, type ExtractionResult, type RejectedClaim } from "./ai";
import { getDb, tx } from "./db";
import { recomputeInTx } from "./repo";

export class IngestError extends Error {
  constructor(
    public code: "NOT_FOUND" | "INVALID" | "CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export type ImportInput = {
  source: { id: string } | { name: string; kind: SourceKind };
  title: string;
  body: string;
  url?: string | null;
  providerId?: string | null;
  repostedFromId?: string | null;
  publishedAt?: string | null; // free text, parsed with parseTime (Beijing time when no zone)
  sourceUpdatedAt?: string | null;
  subjectHint?: string | null;
};

export type ImportResult = { decision: IngestDecision; documentId: string; versionId: string };

/**
 * Shared by manual import and provider sync. Same canonical key = same document;
 * same content hash = duplicate (no new rows); changed content = new version.
 * fetched_at is always the system clock, never taken from input.
 */
export function importDocument(input: ImportInput, db = getDb(), now = new Date().toISOString()): ImportResult {
  const body = input.body.trim();
  if (!body) throw new IngestError("INVALID", "正文为空");
  const published = parseTime(input.publishedAt);
  const updated = parseTime(input.sourceUpdatedAt);
  const hash = contentHash(body);
  return tx(db, () => {
    let sourceId: string;
    if ("id" in input.source) {
      if (!db.prepare("select 1 from sources where id = ?").get(input.source.id)) throw new IngestError("NOT_FOUND", "来源不存在");
      sourceId = input.source.id;
    } else {
      const existing = db.prepare("select id from sources where name = ?").get(input.source.name) as { id: string } | undefined;
      sourceId = existing?.id ?? randomUUID();
      if (!existing) {
        db.prepare("insert into sources (id, name, kind, tier, access_mode) values (?, ?, ?, ?, 'manual')").run(
          sourceId, input.source.name, input.source.kind, DEFAULT_TIER[input.source.kind],
        );
      }
    }
    if (input.repostedFromId && !db.prepare("select 1 from documents where id = ?").get(input.repostedFromId)) {
      throw new IngestError("NOT_FOUND", "转载来源文档不存在");
    }
    // Without URL or provider id the content itself is the identity.
    const key = canonicalKey({ url: input.url, providerId: input.providerId }) ?? `content:${hash}`;
    const doc = db.prepare("select id from documents where canonical_key = ?").get(key) as { id: string } | undefined;
    const versions = doc
      ? (db.prepare("select id, content_hash from document_versions where document_id = ? order by fetched_at, rowid").all(doc.id) as { id: string; content_hash: string }[])
      : [];
    const decision = decideIngest(doc ? { hashes: versions.map((v) => v.content_hash) } : null, hash);
    if (decision === "duplicate") {
      if (input.subjectHint) {
        db.prepare("update document_versions set subject_hint = coalesce(subject_hint, ?) where id = ?").run(
          input.subjectHint, versions.find((v) => v.content_hash === hash)!.id,
        );
      }
      return { decision, documentId: doc!.id, versionId: versions.find((v) => v.content_hash === hash)!.id };
    }
    const documentId = doc?.id ?? randomUUID();
    if (!doc) {
      db.prepare("insert into documents (id, source_id, canonical_key, url, title, reposted_from_id) values (?, ?, ?, ?, ?, ?)").run(
        documentId, sourceId, key, input.url?.trim() || null, input.title, input.repostedFromId ?? null,
      );
    }
    const versionId = randomUUID();
    db.prepare(
      `insert into document_versions (id, document_id, body, content_hash, published_at, published_precision, source_updated_at, fetched_at, previous_version_id, subject_hint)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(versionId, documentId, body, hash, published?.iso ?? null, published?.precision ?? null, updated?.iso ?? null, now, versions.at(-1)?.id ?? null, input.subjectHint ?? null);
    return { decision, documentId, versionId };
  });
}

export type StoredAnalysis = {
  event: ExtractionResult["event"] | null;
  rejected: RejectedClaim[];
  candidates: (CandidateScore & { title: string })[];
};

type VersionRow = { id: string; body: string; title: string; source_name: string; analysis: string | null; subject_hint: string | null };

function getVersion(versionId: string, db: DatabaseSync): VersionRow {
  const v = db
    .prepare(
      `select v.id, v.body, v.analysis, v.subject_hint, d.title, s.name as source_name
       from document_versions v join documents d on d.id = v.document_id join sources s on s.id = d.source_id where v.id = ?`,
    )
    .get(versionId) as VersionRow | undefined;
  if (!v) throw new IngestError("NOT_FOUND", "资料版本不存在");
  return v;
}

/** Candidate events: rule scores; same company alone stays below threshold. */
export function candidatesFor(features: ExtractionResult["event"], date: string | null, db = getDb()) {
  // Without a subject there is nothing to score against; the user picks the event by hand.
  if (!features.subjectCode) return [];
  const events = db
    .prepare(
      `select e.id, e.title, e.subject_code as subjectCode, e.event_type as eventType, e.matter_key as matterKey,
              (select min(coalesce(c.occurred_at, v.published_at)) from event_evidence ee join claims c on c.id = ee.claim_id
                 join document_versions v on v.id = c.version_id where ee.event_id = e.id) as anchorDate
       from events e`,
    )
    .all() as { id: string; title: string; subjectCode: string; eventType: string; matterKey: string; anchorDate: string | null }[];
  const titles = new Map(events.map((e) => [e.id, e.title]));
  return rankCandidates({ subjectCode: features.subjectCode, eventType: features.eventType, matterKey: features.matterKey ?? null, date }, events).map(
    (c) => ({ ...c, title: titles.get(c.eventId)! }),
  );
}

const insertClaim = (db: DatabaseSync, versionId: string, c: ReturnType<typeof validateClaims>["claims"][number]) => {
  const occ = parseTime(c.occurredAt);
  const id = randomUUID();
  db.prepare(
    `insert into claims (id, version_id, quote, quote_start, category, subject_code, object, content, occurred_at, occurred_precision, occurred_text, valid_until, unit, basis)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, versionId, c.quote, c.quoteStart, c.category, c.subjectCode ?? null, c.object ?? null, c.content,
    occ?.iso ?? null, occ?.precision ?? null, c.occurredText ?? null, parseTime(c.validUntil)?.iso ?? null, c.unit ?? null, c.basis ?? null,
  );
  return id;
};

/**
 * Run extraction for a version. On failure the document stays (status failed + error) and can be retried
 * or given claims by hand. Re-analysis replaces only claims not yet linked to any event.
 */
export async function analyzeVersion(versionId: string, extractor: Extractor = modelExtractor, db = getDb(), subjectHint?: string | null) {
  const v = getVersion(versionId, db);
  let result: ExtractionResult;
  try {
    result = await extractor({ title: v.title, body: v.body, sourceName: v.source_name, subjectHint: subjectHint || v.subject_hint });
  } catch (e) {
    const msg = e instanceof AiError ? `${e.code}：${e.message}` : "分析失败";
    db.prepare("update document_versions set analysis_status = 'failed', analysis_error = ? where id = ?").run(msg, versionId);
    return { ok: false as const, error: msg, code: e instanceof AiError ? e.code : "AI_UPSTREAM" };
  }
  const date = result.claims.map((c) => parseTime(c.occurredAt)?.iso).find(Boolean) ?? null;
  const analysis: StoredAnalysis = { event: result.event, rejected: result.rejected, candidates: candidatesFor(result.event, date, db) };
  tx(db, () => {
    db.prepare("delete from claims where version_id = ? and id not in (select claim_id from event_evidence) and id not in (select target_claim_id from event_evidence where target_claim_id is not null)").run(versionId);
    for (const c of result.claims) insertClaim(db, versionId, c);
    db.prepare("update document_versions set analysis_status = 'done', analysis_error = null, analysis = ? where id = ?").run(JSON.stringify(analysis), versionId);
  });
  return { ok: true as const, analysis };
}

/** Manual claim entry (model missing or wrong). Same verbatim-quote check as model output. */
export function addManualClaim(versionId: string, raw: unknown, db = getDb()) {
  const v = getVersion(versionId, db);
  const { claims, rejected } = validateClaims(v.body, [raw]);
  if (!claims.length) throw new IngestError("INVALID", rejected[0].reason);
  return insertClaim(db, versionId, claims[0]);
}

export type LinkInput = { claimId: string; relation: Relation; targetClaimId?: string | null; reason: string };
export type NewEvent = { title: string; eventType: string; subjectCode: string; matterKey: string; instrumentName?: string | null };

/**
 * Link claims to an existing or new event and recompute in the same transaction.
 * Every non-plain relation must name a target claim already in the event (or in this batch).
 */
export function associate(
  input: { eventId?: string | null; newEvent?: NewEvent | null; links: LinkInput[] },
  db = getDb(),
  now = new Date().toISOString(),
) {
  if (!input.links.length) throw new IngestError("INVALID", "至少需要一条论断");
  return tx(db, () => {
    let eventId = input.eventId ?? null;
    if (eventId) {
      if (!db.prepare("select 1 from events where id = ?").get(eventId)) throw new IngestError("NOT_FOUND", "事件不存在");
    } else if (input.newEvent) {
      const ne = input.newEvent;
      if (db.prepare("select 1 from events where matter_key = ?").get(ne.matterKey)) throw new IngestError("CONFLICT", "已存在相同事项标识的事件，请选择该事件");
      eventId = randomUUID();
      db.prepare("insert into events (id, title, event_type, subject_code, matter_key) values (?, ?, ?, ?, ?)").run(eventId, ne.title, ne.eventType, ne.subjectCode, ne.matterKey);
      db.prepare("insert into event_instruments (event_id, code, name, link, reason, claim_id) values (?, ?, ?, 'direct', '事件主体标的', ?)").run(
        eventId, ne.subjectCode, ne.instrumentName || ne.subjectCode, input.links[0].claimId,
      );
    } else throw new IngestError("INVALID", "需要选择事件或新建事件");

    const inEvent = new Set(
      (db.prepare("select claim_id from event_evidence where event_id = ? and revoked_at is null").all(eventId) as { claim_id: string }[]).map((r) => r.claim_id),
    );
    for (const l of input.links) inEvent.add(l.claimId);
    const ids: string[] = [];
    for (const l of input.links) {
      if (!db.prepare("select 1 from claims where id = ?").get(l.claimId)) throw new IngestError("NOT_FOUND", `论断不存在：${l.claimId}`);
      if (l.relation !== "supports" && !l.targetClaimId) throw new IngestError("INVALID", "反驳、更正、替代必须指向目标论断");
      if (l.targetClaimId && (!inEvent.has(l.targetClaimId) || l.targetClaimId === l.claimId)) throw new IngestError("INVALID", "目标论断必须是该事件中的其他论断");
      const id = randomUUID();
      try {
        db.prepare("insert into event_evidence (id, event_id, claim_id, relation, target_claim_id, reason, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(
          id, eventId, l.claimId, l.relation, l.targetClaimId ?? null, l.reason, now,
        );
      } catch {
        throw new IngestError("CONFLICT", "该关联已存在");
      }
      db.prepare("update claims set review_status = 'accepted' where id = ?").run(l.claimId);
      ids.push(id);
    }
    const r = recomputeInTx(eventId!, now, db);
    return { eventId: eventId!, evidenceIds: ids, conclusionChanged: r.changed };
  });
}

/** Revoke keeps the row (revoked_at) so history stays auditable, then recomputes. */
export function revoke(evidenceId: string, db = getDb(), now = new Date().toISOString()) {
  return tx(db, () => {
    const row = db.prepare("select event_id, revoked_at from event_evidence where id = ?").get(evidenceId) as { event_id: string; revoked_at: string | null } | undefined;
    if (!row) throw new IngestError("NOT_FOUND", "关联不存在");
    if (row.revoked_at) throw new IngestError("CONFLICT", "该关联已撤销");
    db.prepare("update event_evidence set revoked_at = ? where id = ?").run(now, evidenceId);
    const r = recomputeInTx(row.event_id, now, db);
    return { eventId: row.event_id, conclusionChanged: r.changed };
  });
}
