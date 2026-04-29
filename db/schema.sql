-- =============================================================================
-- 3GPP MCP Server — SQLite Schema v1
-- Migrates from flat JSON (22K chunks in-memory) to structured SQLite with
-- FTS5 full-text search and optional vector search (sqlite-vec).
-- =============================================================================

PRAGMA user_version = 2;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

-- Each 3GPP specification (e.g., TS 24.301) gets one row.
CREATE TABLE IF NOT EXISTS specs (
  id TEXT PRIMARY KEY,               -- e.g., 'ts_24_301'
  title TEXT NOT NULL,               -- e.g., 'Non-Access-Stratum (NAS) protocol for EPS'
  version TEXT,                      -- e.g., 'v18.9.0'
  series TEXT,                       -- e.g., '24' (for grouping)
  description TEXT,                  -- Brief description (160-240 chars)
  total_sections INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  source_pdf TEXT,                   -- Original PDF filename
  ingested_at TEXT DEFAULT (datetime('now'))
);

-- Table of contents — lightweight navigation index.
CREATE TABLE IF NOT EXISTS toc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT NOT NULL REFERENCES specs(id),
  section_number TEXT NOT NULL,      -- e.g., '5.3.2.1'
  section_title TEXT NOT NULL,
  page INTEGER,
  depth INTEGER DEFAULT 0,          -- 0=top-level, 1=sub, etc.
  brief TEXT,                       -- First sentence or ~180 chars
  sort_order INTEGER,               -- Preserve document order
  UNIQUE(spec_id, section_number)
);

-- Full section content — the primary search corpus.
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,              -- e.g., 'ts_24_301:5.3.2.1'
  spec_id TEXT NOT NULL REFERENCES specs(id),
  section_number TEXT NOT NULL,
  section_title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  content TEXT NOT NULL,
  content_length INTEGER,
  parent_section TEXT,              -- e.g., 'ts_24_301:5.3.2'
  depth INTEGER DEFAULT 0,
  UNIQUE(spec_id, section_number)
);

-- ---------------------------------------------------------------------------
-- FTS5 full-text search (BM25 ranking)
-- ---------------------------------------------------------------------------

-- Content-sync'd virtual table — kept in sync via triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  section_title,
  content,
  content='sections',
  content_rowid='rowid'
);

-- Triggers to keep FTS index in sync with the sections table.
CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
  INSERT INTO sections_fts(rowid, section_title, content)
  VALUES (new.rowid, new.section_title, new.content);
END;

CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, section_title, content)
  VALUES ('delete', old.rowid, old.section_title, old.content);
END;

CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, section_title, content)
  VALUES ('delete', old.rowid, old.section_title, old.content);
  INSERT INTO sections_fts(rowid, section_title, content)
  VALUES (new.rowid, new.section_title, new.content);
END;

-- ---------------------------------------------------------------------------
-- Vector table placeholder (created at runtime when sqlite-vec is available)
-- ---------------------------------------------------------------------------
-- CREATE VIRTUAL TABLE IF NOT EXISTS vec_sections USING vec0(
--   section_id TEXT PRIMARY KEY,
--   embedding float[384]
-- );

CREATE TABLE IF NOT EXISTS embedding_index_metadata (
  index_name TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  query_prefix TEXT NOT NULL,
  passage_prefix TEXT NOT NULL,
  prefix_policy_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_signature TEXT NOT NULL,
  section_count INTEGER NOT NULL,
  vec_row_count INTEGER NOT NULL,
  last_built_scope TEXT NOT NULL DEFAULT 'all',
  last_built_spec_id TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_toc_spec ON toc(spec_id);
CREATE INDEX IF NOT EXISTS idx_sections_spec ON sections(spec_id);
CREATE INDEX IF NOT EXISTS idx_sections_parent ON sections(parent_section);
CREATE INDEX IF NOT EXISTS idx_sections_spec_cover ON sections(spec_id, section_number, section_title, id);

-- ---------------------------------------------------------------------------
-- Cross-spec citation graph (populated by scripts/extract_cross_refs.js)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spec_references (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_spec_id TEXT    NOT NULL,
  target_spec_id TEXT    NOT NULL,
  ref_type       TEXT    NOT NULL,       -- '3gpp' | 'rfc'
  citation_text  TEXT,
  section_id     TEXT,
  in_corpus      INTEGER DEFAULT 0,
  UNIQUE(source_spec_id, target_spec_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_specref_source ON spec_references(source_spec_id);
CREATE INDEX IF NOT EXISTS idx_specref_target ON spec_references(target_spec_id);

-- ---------------------------------------------------------------------------
-- ETSI/3GPP catalog layer
-- ---------------------------------------------------------------------------
-- These tables describe the public ETSI delivery tree independently from
-- whether a document has been downloaded, extracted, or embedded.

CREATE TABLE IF NOT EXISTS etsi_publication_types (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS etsi_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_type TEXT NOT NULL REFERENCES etsi_publication_types(id),
  range_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  directory_modified_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_type, range_name)
);

CREATE TABLE IF NOT EXISTS etsi_documents (
  id TEXT PRIMARY KEY,
  publication_type TEXT NOT NULL REFERENCES etsi_publication_types(id),
  etsi_number TEXT NOT NULL,
  range_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  mapped_3gpp_id TEXT,
  mapped_3gpp_spec TEXT,
  latest_version TEXT,
  latest_version_id INTEGER,
  version_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_type, etsi_number)
);

CREATE TABLE IF NOT EXISTS etsi_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES etsi_documents(id),
  version TEXT NOT NULL,
  suffix TEXT,
  source_url TEXT NOT NULL,
  directory_modified_at TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, version, suffix)
);

CREATE TABLE IF NOT EXISTS etsi_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES etsi_versions(id),
  document_id TEXT NOT NULL REFERENCES etsi_documents(id),
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  size_bytes INTEGER,
  modified_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, filename)
);

CREATE TABLE IF NOT EXISTS catalog_crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_hash TEXT,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  requests_made INTEGER NOT NULL DEFAULT 0,
  publication_types_seen INTEGER NOT NULL DEFAULT 0,
  ranges_seen INTEGER NOT NULL DEFAULT 0,
  documents_seen INTEGER NOT NULL DEFAULT 0,
  versions_seen INTEGER NOT NULL DEFAULT 0,
  files_seen INTEGER NOT NULL DEFAULT 0,
  warnings TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  heartbeat_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS catalog_crawl_progress (
  run_id INTEGER NOT NULL REFERENCES catalog_crawl_runs(id),
  unit_type TEXT NOT NULL,
  publication_type TEXT,
  range_name TEXT,
  document_id TEXT,
  version_id INTEGER,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(run_id, unit_type, publication_type, range_name, document_id, version_id)
);

CREATE TABLE IF NOT EXISTS etsi_document_status (
  document_id TEXT PRIMARY KEY REFERENCES etsi_documents(id),
  selected_for_ingest INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT,
  download_status TEXT NOT NULL DEFAULT 'not_selected',
  extract_status TEXT NOT NULL DEFAULT 'not_selected',
  embedding_status TEXT NOT NULL DEFAULT 'not_selected',
  latest_cataloged_version_id INTEGER,
  downloaded_file_path TEXT,
  extracted_spec_id TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_etsi_ranges_pub ON etsi_ranges(publication_type);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_pub_range ON etsi_documents(publication_type, range_name);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_mapped ON etsi_documents(mapped_3gpp_id);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_latest ON etsi_documents(publication_type, latest_version);
CREATE INDEX IF NOT EXISTS idx_etsi_versions_document ON etsi_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_etsi_files_document ON etsi_files(document_id);
CREATE INDEX IF NOT EXISTS idx_etsi_files_version ON etsi_files(version_id);
CREATE INDEX IF NOT EXISTS idx_catalog_runs_scope ON catalog_crawl_runs(source, scope_hash, status);
CREATE INDEX IF NOT EXISTS idx_catalog_progress_run_status ON catalog_crawl_progress(run_id, unit_type, status);
CREATE INDEX IF NOT EXISTS idx_etsi_doc_status_ingest ON etsi_document_status(selected_for_ingest, download_status, extract_status, embedding_status);

-- ---------------------------------------------------------------------------
-- Ingestion tracking — records each data load for auditability.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT,
  source_type TEXT,                 -- 'pdf_extraction' or 'legacy_migration'
  rows_inserted INTEGER,
  warnings TEXT,                    -- JSON array of warning strings
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
