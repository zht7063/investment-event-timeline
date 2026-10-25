-- All timestamps are ISO 8601 UTC strings. Nullable times mean "unknown", never back-filled.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regulator','issuer','media','research','rumor','market_data','manual')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('constructed','live','unavailable')),
  last_success_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_key TEXT NOT NULL UNIQUE, -- normalized URL or provider id
  url TEXT,
  title TEXT NOT NULL,
  reposted_from_id TEXT REFERENCES documents(id),
  is_constructed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_at TEXT,
  source_updated_at TEXT,
  fetched_at TEXT NOT NULL,
  previous_version_id TEXT REFERENCES document_versions(id),
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending','done','failed')),
  analysis_error TEXT,
  UNIQUE (document_id, content_hash)
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES document_versions(id),
  quote TEXT NOT NULL,
  quote_start INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('fact','opinion','speculation','rumor')),
  subject_code TEXT,
  matter_key TEXT,
  object TEXT,
  content TEXT NOT NULL,
  occurred_at TEXT,
  occurred_precision TEXT CHECK (occurred_precision IN ('day','month','quarter','year','datetime')),
  occurred_text TEXT,
  valid_until TEXT,
  unit TEXT,
  basis TEXT, -- statistical basis / caliber of numbers
  review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','accepted','rejected'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  matter_key TEXT NOT NULL,
  current_conclusion_id TEXT,
  is_constructed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_evidence (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  claim_id TEXT NOT NULL REFERENCES claims(id),
  relation TEXT NOT NULL CHECK (relation IN ('supports','refutes','corrects','supersedes')),
  target_claim_id TEXT REFERENCES claims(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_active
  ON event_evidence(event_id, claim_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS event_instruments (
  event_id TEXT NOT NULL REFERENCES events(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  link TEXT NOT NULL CHECK (link IN ('direct','indirect')),
  reason TEXT NOT NULL,
  claim_id TEXT REFERENCES claims(id),
  PRIMARY KEY (event_id, code)
);

CREATE TABLE IF NOT EXISTS conclusions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL CHECK (status IN ('unverified','supported','conflicted','denied','expired')),
  summary TEXT NOT NULL, -- JSON array of {text, evidenceIds}
  evidence_ids TEXT NOT NULL, -- JSON array, sorted
  conflicts TEXT NOT NULL, -- JSON
  missing TEXT NOT NULL, -- JSON array
  generated_at TEXT NOT NULL,
  previous_id TEXT REFERENCES conclusions(id),
  change_reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  added INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
