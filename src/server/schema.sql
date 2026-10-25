-- All timestamps are ISO 8601 UTC strings. Nullable times mean "unknown", never back-filled.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regulator','issuer','media','research','rumor','market_data','manual')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('constructed','live','manual','unavailable')),
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
  published_precision TEXT CHECK (published_precision IN ('day','month','quarter','year','datetime')),
  source_updated_at TEXT,
  fetched_at TEXT NOT NULL,
  previous_version_id TEXT REFERENCES document_versions(id),
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending','done','failed')),
  analysis_error TEXT,
  analysis TEXT, -- JSON: extracted event features + rejected claims, for the import preview
  subject_hint TEXT,
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
  ON event_evidence(event_id, claim_id, relation, coalesce(target_claim_id, '')) WHERE revoked_at IS NULL;

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

-- On-demand research uses immutable material snapshots, independent of demo reset/manual review.
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  name TEXT,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','failed','cancelled')),
  phase TEXT NOT NULL DEFAULT 'resolve',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT
);
CREATE INDEX IF NOT EXISTS research_queue ON research_jobs(status, lease_until, created_at);
CREATE TABLE IF NOT EXISTS research_source_runs (
  job_id TEXT NOT NULL REFERENCES research_jobs(id),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY(job_id, source_id)
);
CREATE TABLE IF NOT EXISTS research_materials (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_id TEXT NOT NULL,
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  UNIQUE(provider_key, content_hash)
);
CREATE TABLE IF NOT EXISTS research_documents (
  job_id TEXT NOT NULL REFERENCES research_jobs(id),
  material_id TEXT NOT NULL REFERENCES research_materials(id),
  range_status TEXT NOT NULL CHECK(range_status IN ('inside','unknown')),
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK(analysis_status IN ('pending','done','failed','excluded')),
  analysis TEXT,
  error TEXT,
  PRIMARY KEY(job_id, material_id)
);
CREATE TABLE IF NOT EXISTS research_analysis_cache (
  material_id TEXT NOT NULL REFERENCES research_materials(id),
  code TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  analysis TEXT NOT NULL,
  PRIMARY KEY(material_id, code, analysis_version)
);
CREATE TABLE IF NOT EXISTS research_reports (
  job_id TEXT PRIMARY KEY REFERENCES research_jobs(id),
  revision INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_relations (
  job_id TEXT NOT NULL REFERENCES research_jobs(id),
  group_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  PRIMARY KEY(job_id, group_id)
);
