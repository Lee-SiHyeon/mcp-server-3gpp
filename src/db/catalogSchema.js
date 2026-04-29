export const CATALOG_SCHEMA_SQL = `
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
`;

export function ensureCatalogSchema(db) {
  db.exec(CATALOG_SCHEMA_SQL);
  ensureColumns(db, 'catalog_crawl_runs', {
    scope_hash: 'TEXT',
    checkpoint_json: 'TEXT',
    heartbeat_at: 'TEXT',
  });
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_catalog_runs_scope ON catalog_crawl_runs(source, scope_hash, status);
    CREATE INDEX IF NOT EXISTS idx_catalog_progress_run_status ON catalog_crawl_progress(run_id, unit_type, status);
    CREATE INDEX IF NOT EXISTS idx_etsi_doc_status_ingest ON etsi_document_status(selected_for_ingest, download_status, extract_status, embedding_status);
  `);
}

function ensureColumns(db, tableName, columns) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name)
  );

  for (const [columnName, definition] of Object.entries(columns)) {
    if (!existing.has(columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
}
