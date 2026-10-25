import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { computeConclusion, describeChange, signature } from "@/domain/conclusion";
import { rootOf } from "@/domain/evidence";
import type { ConclusionDraft, EvidenceItem, Precision, Relation, Status } from "@/domain/types";
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

export type EvidenceRow = EvidenceItem & {
  quoteStart: number;
  occurredAt: string | null;
  occurredPrecision: Precision | null;
  occurredText: string | null;
  publishedPrecision: Precision | null;
  sourceUpdatedAt: string | null;
  sourceKind: string;
  documentTitle: string;
  url: string | null;
  isConstructed: boolean;
  chainBroken: boolean;
  unit: string | null;
  basis: string | null;
  targetContent: string | null;
};

export type EventDetail = {
  event: { id: string; title: string; event_type: string; subject_code: string; matter_key: string; is_constructed: number };
  instruments: { code: string; name: string; link: "direct" | "indirect"; reason: string; claim_id: string | null }[];
  evidence: EvidenceRow[];
  conclusion: ConclusionDraft;
  asOf: string;
  isHistorical: boolean;
  history: ConclusionRow[];
};

/**
 * Detail view. Live view recomputes first so a lapsed valid_until is reflected on read.
 * asOf view computes from evidence visible at that moment only; it never writes history.
 */
export function getEventDetail(eventId: string, asOf?: string | null, db = getDb()): EventDetail | null {
  const event = db.prepare("select id, title, event_type, subject_code, matter_key, is_constructed from events where id = ?").get(eventId) as EventDetail["event"] | undefined;
  if (!event) return null;
  const now = new Date().toISOString();
  const at = asOf && asOf < now ? asOf : now;
  if (at === now) recompute(eventId, now, db);
  const base = loadEvidence(eventId, db);
  const extra = new Map(
    (
      db
        .prepare(
          `select ee.id, c.quote_start, c.occurred_at, c.occurred_precision, c.occurred_text, c.unit, c.basis,
                  v.published_precision, v.source_updated_at, s.kind, d.title, d.url, d.is_constructed, d.id as doc_id, t.content as target_content
           from event_evidence ee join claims c on c.id = ee.claim_id
           join document_versions v on v.id = c.version_id join documents d on d.id = v.document_id join sources s on s.id = d.source_id
           left join claims t on t.id = ee.target_claim_id
           where ee.event_id = ?`,
        )
        .all(eventId) as Record<string, string | number | null>[]
    ).map((r) => [r.id as string, r]),
  );
  const chain = new Map(
    (db.prepare("select id, reposted_from_id from documents").all() as { id: string; reposted_from_id: string | null }[]).map((d) => [d.id, d.reposted_from_id] as const),
  );
  const evidence: EvidenceRow[] = base.map((b) => {
    const r = extra.get(b.id)!;
    return {
      ...b,
      quoteStart: r.quote_start as number,
      occurredAt: r.occurred_at as string | null,
      occurredPrecision: r.occurred_precision as Precision | null,
      occurredText: r.occurred_text as string | null,
      publishedPrecision: r.published_precision as Precision | null,
      sourceUpdatedAt: r.source_updated_at as string | null,
      sourceKind: r.kind as string,
      documentTitle: r.title as string,
      url: r.url as string | null,
      isConstructed: r.is_constructed === 1,
      chainBroken: rootOf(b.documentId, chain).chainBroken,
      unit: r.unit as string | null,
      basis: r.basis as string | null,
      targetContent: r.target_content as string | null,
    };
  });
  return {
    event,
    instruments: db.prepare("select code, name, link, reason, claim_id from event_instruments where event_id = ? order by link, code").all(eventId) as EventDetail["instruments"],
    evidence,
    conclusion: computeConclusion(base, at),
    asOf: at,
    isHistorical: at !== now,
    history: conclusionHistory(eventId, db).filter((h) => h.generated_at <= at),
  };
}

export type EventSummary = EventListItem & {
  event_type: string;
  instruments: string; // comma-separated codes
  evidence_count: number;
  latest_fetched_at: string | null;
  is_constructed: number;
};

/** List with filters. Status filter uses the stored current conclusion (refreshed for expiry first). */
export function searchEvents(q: { text?: string; status?: Status; codes?: string[]; limit?: number; offset?: number }, db = getDb()) {
  const now = new Date().toISOString();
  // Expiry is time-driven: refresh conclusions whose validity windows may have lapsed since last write.
  for (const { id } of db.prepare("select id from events").all() as { id: string }[]) recompute(id, now, db);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.text) {
    where.push("(e.title like ? or e.subject_code like ? or exists (select 1 from event_instruments i where i.event_id = e.id and (i.name like ? or i.code like ?)))");
    const like = `%${q.text}%`;
    args.push(like, like, like, like);
  }
  if (q.status) {
    where.push("c.status = ?");
    args.push(q.status);
  }
  if (q.codes?.length) {
    where.push(`exists (select 1 from event_instruments i where i.event_id = e.id and i.code in (${q.codes.map(() => "?").join(",")}))`);
    args.push(...q.codes);
  }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  const offset = Math.max(q.offset ?? 0, 0);
  const sql = `select e.id, e.title, e.subject_code, e.event_type, e.is_constructed, c.status, c.generated_at,
      (select group_concat(code) from event_instruments i where i.event_id = e.id) as instruments,
      (select count(*) from event_evidence ee where ee.event_id = e.id and ee.revoked_at is null) as evidence_count,
      (select max(v.fetched_at) from event_evidence ee join claims cl on cl.id = ee.claim_id join document_versions v on v.id = cl.version_id
         where ee.event_id = e.id and ee.revoked_at is null) as latest_fetched_at
    from events e left join conclusions c on c.id = e.current_conclusion_id
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by c.generated_at desc, e.title limit ? offset ?`;
  const items = plain(db.prepare(sql).all(...args, limit, offset)) as EventSummary[];
  const total = (db.prepare(`select count(*) as n from events e left join conclusions c on c.id = e.current_conclusion_id ${where.length ? `where ${where.join(" and ")}` : ""}`).get(...args) as { n: number }).n;
  return { items, total, limit, offset };
}

export function listSources(db = getDb()) {
  return plain(db.prepare("select id, name, kind, tier, access_mode, last_success_at, last_error from sources order by tier, name").all()) as {
    id: string; name: string; kind: string; tier: number; access_mode: string; last_success_at: string | null; last_error: string | null;
  }[];
}

export function listDocuments(db = getDb()) {
  return plain(db.prepare("select d.id, d.title, s.name as source_name from documents d join sources s on s.id = d.source_id order by d.rowid desc limit 200").all()) as {
    id: string; title: string; source_name: string;
  }[];
}

export function listEventOptions(db = getDb()) {
  return plain(db.prepare("select id, title, subject_code, event_type, matter_key from events order by title").all()) as {
    id: string; title: string; subject_code: string; event_type: string; matter_key: string;
  }[];
}

/** node:sqlite rows have a null prototype, which React refuses to pass to Client Components. */
const plain = (rows: unknown[]) => rows.map((r) => ({ ...(r as object) }));

export function listSyncRuns(db = getDb()) {
  return plain(
    db.prepare("select id, source_id, started_at, finished_at, status, added, duplicates, error from sync_runs order by started_at desc limit 100").all(),
  ) as {
    id: string; source_id: string; started_at: string; finished_at: string | null;
    status: string; added: number; duplicates: number; error: string | null;
  }[];
}

/** Documents from providers that have not yet been linked to an event. */
export function listPendingDocuments(db = getDb()) {
  return plain(
    db.prepare(
      `select d.id, d.title, s.name as source_name, v.analysis_status, v.published_at, v.fetched_at, v.id as version_id
       from documents d join sources s on s.id = d.source_id
       join document_versions v on v.document_id = d.id
       where v.id = (select v2.id from document_versions v2 where v2.document_id = d.id order by v2.fetched_at desc, v2.rowid desc limit 1)
         and not exists (select 1 from claims c join event_evidence ee on ee.claim_id = c.id where c.version_id = v.id and ee.revoked_at is null)
       order by v.fetched_at desc limit 50`,
    ).all(),
  ) as {
    id: string; title: string; source_name: string; analysis_status: string; published_at: string | null; fetched_at: string; version_id: string;
  }[];
}
