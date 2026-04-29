/**
 * Database initialization module.
 *
 * Reads db/schema.sql from the project root and applies it to a new SQLite
 * database.  Also probes for the sqlite-vec extension to enable optional
 * vector search.
 *
 * Usage:
 *   import { initDatabase } from './schema.js';
 *   const { db, features } = initDatabase('/path/to/3gpp.db');
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureEmbeddingMetadataTable } from '../embeddings/indexMetadata.js';
import { ensureCatalogSchema } from './catalogSchema.js';

// Resolve project root: this file lives at src/db/schema.js → go up two levels.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Read the DDL once at module load time — it never changes at runtime.
const SCHEMA_SQL_PATH = path.join(PROJECT_ROOT, 'db', 'schema.sql');
const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf-8');

/** Tables the schema must create (used to verify a successful apply). */
const REQUIRED_TABLES = [
  'specs',
  'toc',
  'sections',
  'sections_fts',
  'ingestion_runs',
  'etsi_documents',
  'etsi_versions',
];

/**
 * Initialise (or open) a SQLite database with the 3GPP schema.
 *
 * @param {string} dbPath — Absolute or relative path to the .db file.
 * @returns {{ db: import('better-sqlite3').Database, features: { vectorSearch: boolean, ftsSearch: boolean } }}
 */
export function initDatabase(dbPath) {
  const verbose = process.env.DEBUG_DB
    ? (/** @type {string} */ msg) => process.stderr.write(`[DB] ${msg}\n`)
    : undefined;

  const db = new Database(dbPath, { verbose });

  // --- Performance pragmas ------------------------------------------------
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // --- Schema application -------------------------------------------------
  const currentVersion = /** @type {number} */ (db.pragma('user_version', { simple: true }));

  if (currentVersion === 0) {
    db.exec(schemaSql);

    // Verify that all expected tables were created.
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')")
      .all();
    const names = new Set(rows.map((/** @type {{ name: string }} */ r) => r.name));

    for (const table of REQUIRED_TABLES) {
      if (!names.has(table)) {
        throw new Error(
          `Schema verification failed: table "${table}" was not created. ` +
          `Found: ${[...names].join(', ')}`
        );
      }
    }
  }

  // Existing v1 databases predate the catalog layer. Keep this idempotent so
  // tools can open a prebuilt corpus and still expose catalog functionality.
  ensureCatalogSchema(db);

  // --- Optional: sqlite-vec extension -------------------------------------
  const features = { vectorSearch: false, ftsSearch: true };

  try {
    sqliteVec.load(db);

    // Extension loaded — create the vector table if it doesn't already exist.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_sections USING vec0(
        section_id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `);
    features.vectorSearch = true;
  } catch {
    // sqlite-vec not available — vector search disabled, which is fine.
  }

  ensureEmbeddingMetadataTable(db);

  return { db, features };
}
