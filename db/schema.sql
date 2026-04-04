-- =============================================================================
-- 3GPP MCP Server — SQLite Schema v1
-- Migrates from flat JSON (22K chunks in-memory) to structured SQLite with
-- FTS5 full-text search and optional vector search (sqlite-vec).
-- =============================================================================

PRAGMA user_version = 1;

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

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_toc_spec ON toc(spec_id);
CREATE INDEX IF NOT EXISTS idx_sections_spec ON sections(spec_id);
CREATE INDEX IF NOT EXISTS idx_sections_parent ON sections(parent_section);

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
