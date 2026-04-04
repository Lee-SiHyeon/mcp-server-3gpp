/**
 * Singleton connection factory for the 3GPP SQLite database.
 *
 * Provides a lazily-initialised, process-wide database handle with sensible
 * defaults (WAL mode, busy timeout).  Intentionally does NOT import schema.js
 * — callers that need initialisation should use schema.js directly.
 *
 * Usage:
 *   import { getConnection, closeConnection } from './connection.js';
 *   const db = getConnection();          // uses default data/3gpp.db
 *   const db2 = getConnection('/custom/path.db');
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root: this file lives at src/db/connection.js → up two levels.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Default database location. */
const DEFAULT_DB_PATH = path.resolve(PROJECT_ROOT, 'data', 'corpus', '3gpp.db');

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

/**
 * Return the singleton database connection, creating it on first call.
 *
 * @param {string} [dbPath] — Override the default path (`data/3gpp.db`).
 * @returns {import('better-sqlite3').Database}
 */
export function getConnection(dbPath) {
  // Return existing connection if it is still usable.
  if (_db !== null) {
    try {
      // Quick health-check — will throw if the handle is closed.
      _db.pragma('journal_mode');
      return _db;
    } catch {
      // Handle was closed externally; fall through and re-create.
      _db = null;
    }
  }

  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  const dir = path.dirname(resolvedPath);

  // Ensure the parent directory exists (e.g., first run on a fresh clone).
  fs.mkdirSync(dir, { recursive: true });

  _db = new Database(resolvedPath);

  // Performance pragmas — match what schema.js applies.
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');

  // Load sqlite-vec extension for optional vector search support.
  try {
    sqliteVec.load(_db);
  } catch {
    // sqlite-vec not available — vector search will be disabled.
  }

  return _db;
}

/**
 * Close the singleton connection, if open.  Safe to call multiple times.
 */
export function closeConnection() {
  if (_db !== null) {
    try {
      _db.close();
    } catch {
      // Already closed — ignore.
    }
    _db = null;
  }
}

/**
 * Close and discard the current connection so the next `getConnection()` call
 * creates a fresh handle.  Useful in tests or after a schema migration.
 */
export function resetConnection() {
  closeConnection();
}
