import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { contentHash } from "@/domain/matching";
import { parseTime } from "@/domain/time";
import { getDb, tx } from "./db";
import { replayHistory } from "./repo";

type SeedClaim = { id: string; quote: string; category: string; content: string; occurredAt?: string; validUntil?: string; unit?: string; basis?: string };
type SeedDoc = { id: string; source: string; key: string; url?: string; repostedFrom?: string; title: string; published: string; fetched: string; body: string; claims: SeedClaim[] };
type SeedLink = { id: string; claim: string; relation: string; target?: string; reason: string; at?: string };
type Seed = {
  sources: { id: string; name: string; kind: string; tier: number }[];
  documents: SeedDoc[];
  events: {
    id: string; title: string; type: string; subject: string; matter: string;
    instruments: { code: string; name: string; link: string; reason: string; claim: string | null }[];
    links: SeedLink[];
  }[];
};

export const loadSeed = (): Seed => JSON.parse(readFileSync(join(process.cwd(), "data/seed/demo.json"), "utf8"));

/** First run on an empty database loads the constructed demo chain. */
export function ensureSeeded(db = getDb()) {
  if (!db.prepare("select 1 from sources limit 1").get()) resetToSeed(db);
  return db;
}

const TABLES = ["sync_runs", "conclusions", "event_instruments", "event_evidence", "claims", "events", "document_versions", "documents", "sources"];

/** Wipe everything and load the constructed demo chain. Conclusions are replayed so history is realistic. */
export function resetToSeed(db: DatabaseSync, now = new Date().toISOString(), seed = loadSeed()) {
  const iso = (s: string) => parseTime(s)!.iso;
  tx(db, () => {
    db.exec("update events set current_conclusion_id = null");
    for (const t of TABLES) db.exec(`delete from ${t}`);
    const src = db.prepare("insert into sources (id, name, kind, tier, access_mode) values (?, ?, ?, ?, 'constructed')");
    for (const s of seed.sources) src.run(s.id, s.name, s.kind, s.tier);
    const doc = db.prepare("insert into documents (id, source_id, canonical_key, url, title, reposted_from_id, is_constructed) values (?, ?, ?, ?, ?, ?, 1)");
    const ver = db.prepare(
      "insert into document_versions (id, document_id, body, content_hash, published_at, fetched_at, analysis_status) values (?, ?, ?, ?, ?, ?, 'done')",
    );
    const cl = db.prepare(
      `insert into claims (id, version_id, quote, quote_start, category, content, occurred_at, occurred_precision, valid_until, unit, basis, review_status)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
    );
    // Reposts must reference documents listed earlier in the seed file (FK order).
    for (const d of seed.documents) {
      doc.run(d.id, d.source, d.key, d.url ?? null, d.title, d.repostedFrom ?? null);
      const vid = `${d.id}-v1`;
      ver.run(vid, d.id, d.body, contentHash(d.body), iso(d.published), iso(d.fetched));
      for (const c of d.claims) {
        const start = d.body.indexOf(c.quote);
        if (start < 0) throw new Error(`seed quote not in body: ${c.id}`);
        const occ = parseTime(c.occurredAt);
        cl.run(c.id, vid, c.quote, start, c.category, c.content, occ?.iso ?? null, occ?.precision ?? null, c.validUntil ? iso(c.validUntil) : null, c.unit ?? null, c.basis ?? null);
      }
    }
    const fetchedOf = new Map(seed.documents.flatMap((d) => d.claims.map((c) => [c.id, iso(d.fetched)] as const)));
    const ev = db.prepare("insert into events (id, title, event_type, subject_code, matter_key, is_constructed) values (?, ?, ?, ?, ?, 1)");
    const link = db.prepare(
      "insert into event_evidence (id, event_id, claim_id, relation, target_claim_id, reason, created_at) values (?, ?, ?, ?, ?, ?, ?)",
    );
    const ins = db.prepare("insert into event_instruments (event_id, code, name, link, reason, claim_id) values (?, ?, ?, ?, ?, ?)");
    for (const e of seed.events) {
      ev.run(e.id, e.title, e.type, e.subject, e.matter);
      for (const l of e.links) link.run(`${e.id}:${l.id}`, e.id, l.claim, l.relation, l.target ?? null, l.reason, l.at ? iso(l.at) : fetchedOf.get(l.claim)!);
      for (const i of e.instruments) ins.run(e.id, i.code, i.name, i.link, i.reason, i.claim);
    }
  });
  for (const e of seed.events) replayHistory(e.id, now, db);
}
