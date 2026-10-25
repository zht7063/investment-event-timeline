import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { computeConclusion, describeChange, signature } from "@/domain/conclusion";
import { rootOf } from "@/domain/evidence";
import type { ConclusionDraft, EvidenceItem, Relation, Status } from "@/domain/types";
import { getDb, tx } from "./db";

export type EventListItem = { id: string; title: string; subject_code: string; status: Status | null; generated_at: string | null };

export function listEvents(db = getDb()): EventListItem[] {
  return db
    .prepare(
      `select e.id, e.title, e.subject_code, c.status, c.generated_at
       from events e left join conclusions c on c.id = e.current_conclusion_id
       order by c.generated_at desc, e.title`,
    )
    .all() as EventListItem[];
}

/** Join every evidence link (including revoked ones) with its claim, document version and source. */
export function loadEvidence(eventId: string, db = getDb()): EvidenceItem[] {
  const rows = db
    .prepare(
      `select ee.id, ee.claim_id, ee.relation, ee.target_claim_id, ee.reason, ee.created_at, ee.revoked_at,
              c.category, c.content, c.quote, c.valid_until,
              s.tier, s.name as source_name, d.id as document_id,
              v.published_at, v.fetched_at
       from event_evidence ee
       join claims c on c.id = ee.claim_id
       join document_versions v on v.id = c.version_id
       join documents d on d.id = v.document_id
       join sources s on s.id = d.source_id
       where ee.event_id = ?`,
    )
    .all(eventId) as Record<string, string | number | null>[];
  const chain = new Map(
    (db.prepare("select id, reposted_from_id from documents").all() as { id: string; reposted_from_id: string | null }[]).map(
      (d) => [d.id, d.reposted_from_id] as const,
    ),
  );
  return rows.map((r) => ({
    id: r.id as string,
    claimId: r.claim_id as string,
    relation: r.relation as Relation,
    targetClaimId: r.target_claim_id as string | null,
    reason: r.reason as string,
    createdAt: r.created_at as string,
    revokedAt: r.revoked_at as string | null,
    category: r.category as EvidenceItem["category"],
    content: r.content as string,
    quote: r.quote as string,
    tier: r.tier as number,
    sourceName: r.source_name as string,
    documentId: r.document_id as string,
    rootDocumentId: rootOf(r.document_id as string, chain).rootId,
    publishedAt: r.published_at as string | null,
    fetchedAt: r.fetched_at as string,
    validUntil: r.valid_until as string | null,
  }));
}

type StoredConclusion = Pick<ConclusionDraft, "status" | "evidenceIds" | "supersededIds" | "expiredIds"> & { id: string };

function currentConclusion(eventId: string, db: DatabaseSync): StoredConclusion | null {
  const r = db
    .prepare(
      `select c.id, c.status, c.evidence_ids, c.conflicts from conclusions c
       join events e on e.current_conclusion_id = c.id where e.id = ?`,
    )
    .get(eventId) as { id: string; status: Status; evidence_ids: string; conflicts: string } | undefined;
  if (!r) return null;
  const extra = JSON.parse(r.conflicts) as { supersededIds: string[]; expiredIds: string[] };
  return { id: r.id, status: r.status, evidenceIds: JSON.parse(r.evidence_ids), supersededIds: extra.supersededIds, expiredIds: extra.expiredIds };
}

/**
 * Recompute at `at` and append a conclusion version only if the outcome changed.
 * Runs inside one transaction so history and the current pointer never diverge.
 */
export function recompute(eventId: string, at = new Date().toISOString(), db = getDb()) {
  return tx(db, () => recomputeInTx(eventId, at, db));
}

export function recomputeInTx(eventId: string, at: string, db: DatabaseSync): { changed: boolean; conclusionId: string | null } {
  const items = loadEvidence(eventId, db);
  const draft = computeConclusion(items, at);
  const prev = currentConclusion(eventId, db);
  if (prev && signature(prev) === signature(draft)) return { changed: false, conclusionId: prev.id };
  const byId = new Map(items.map((i) => [i.id, i]));
  const label = (id: string) => {
    const i = byId.get(id);
    return i ? `${i.sourceName}“${i.content}”` : id;
  };
  const id = randomUUID();
  db.prepare(
    `insert into conclusions (id, event_id, status, summary, evidence_ids, conflicts, missing, generated_at, previous_id, change_reason)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    eventId,
    draft.status,
    JSON.stringify(draft.summary),
    JSON.stringify(draft.evidenceIds),
    // Conflict cards plus the superseded/expired partitions needed to diff the next version.
    JSON.stringify({ cards: draft.conflicts, supersededIds: draft.supersededIds, expiredIds: draft.expiredIds }),
    JSON.stringify(draft.missing),
    at,
    prev?.id ?? null,
    describeChange(prev, draft, label),
  );
  db.prepare("update events set current_conclusion_id = ? where id = ?").run(id, eventId);
  return { changed: true, conclusionId: id };
}

export type ConclusionRow = {
  id: string;
  status: Status;
  summary: string;
  evidence_ids: string;
  conflicts: string;
  missing: string;
  generated_at: string;
  previous_id: string | null;
  change_reason: string;
};

export function conclusionHistory(eventId: string, db = getDb()): ConclusionRow[] {
  return db.prepare("select * from conclusions where event_id = ? order by generated_at, rowid").all(eventId) as ConclusionRow[];
}

/** Replay an event at every moment its inputs changed (seeding / reset), then at `until`. */
export function replayHistory(eventId: string, until = new Date().toISOString(), db = getDb()) {
  const moments = new Set<string>();
  for (const i of loadEvidence(eventId, db)) {
    moments.add(i.fetchedAt > i.createdAt ? i.fetchedAt : i.createdAt);
    if (i.revokedAt) moments.add(i.revokedAt);
    if (i.validUntil) moments.add(new Date(Date.parse(i.validUntil) + 1000).toISOString());
  }
  for (const m of [...moments].filter((m) => m <= until).sort()) recompute(eventId, m, db);
  recompute(eventId, until, db);
}
