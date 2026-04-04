/**
 * Migrate legacy chunks.json to structured SQLite database.
 *
 * Handles two legacy shapes:
 *   1. { content, metadata: { source } }  — extraction script output
 *   2. { text, spec }                      — runtime format
 *
 * Creates synthetic section IDs like "{spec_id}:legacy_chunk_{n}"
 * since real section boundaries can't be reconstructed from flat chunks.
 */

import { readFileSync } from 'fs';
import { getConnection } from '../db/connection.js';
import { normalizeSpecId, generateBrief } from './sectionNormalizer.js';

/**
 * @typedef {Object} MigrationReport
 * @property {number} total_chunks
 * @property {number} specs_found
 * @property {Record<string, { chunks: number, inserted: number }>} specs
 * @property {number} synthetic_sections
 * @property {number} empty_rejected
 */

/**
 * Migrate legacy chunks.json to structured SQLite database.
 *
 * @param {string} chunksPath — Path to the legacy chunks.json file.
 * @param {string} dbPath     — Path to the SQLite database.
 * @returns {MigrationReport}
 */
export function migrateLegacyChunks(chunksPath, dbPath) {
  const db = getConnection(dbPath);
  const raw = JSON.parse(readFileSync(chunksPath, 'utf-8'));

  // Detect format: top-level array or object with .chunks
  const chunks = Array.isArray(raw) ? raw : (raw.chunks || []);

  // Group by normalised spec ID
  /** @type {Map<string, string[]>} */
  const specGroups = new Map();
  /** @type {Map<string, string>} original raw spec name per normalised id */
  const specRawNames = new Map();

  for (const chunk of chunks) {
    const text = chunk.content || chunk.text || '';
    const source = chunk.metadata?.source || chunk.spec || 'unknown';
    const specId = normalizeSpecId(source);

    if (!specGroups.has(specId)) {
      specGroups.set(specId, []);
      specRawNames.set(specId, source);
    }
    specGroups.get(specId).push(text);
  }

  /** @type {MigrationReport} */
  const report = {
    total_chunks: chunks.length,
    specs_found: specGroups.size,
    specs: {},
    synthetic_sections: 0,
    empty_rejected: 0,
  };

  const insertSpec = db.prepare(`
    INSERT OR REPLACE INTO specs (id, title, description, total_sections, total_pages)
    VALUES (?, ?, ?, ?, 0)
  `);

  const insertSection = db.prepare(`
    INSERT OR REPLACE INTO sections
      (id, spec_id, section_number, section_title, page_start, page_end, content, content_length, parent_section, depth)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL, 0)
  `);

  const insertIngestion = db.prepare(`
    INSERT INTO ingestion_runs (spec_id, source_type, rows_inserted, warnings, completed_at)
    VALUES (?, 'legacy_migration', ?, ?, datetime('now'))
  `);

  const migrate = db.transaction(() => {
    for (const [specId, texts] of specGroups) {
      let inserted = 0;
      const warnings = [];

      // Build a human-readable title from the normalised ID
      const rawName = specRawNames.get(specId) || specId;
      const title = specId.replace(/_/g, ' ').toUpperCase();

      insertSpec.run(specId, title, `Legacy migration from chunks.json (${rawName})`, texts.length);

      for (let i = 0; i < texts.length; i++) {
        const text = texts[i].trim();
        if (!text) {
          report.empty_rejected++;
          continue;
        }

        const sectionId = `${specId}:legacy_chunk_${i}`;
        const sectionNumber = `legacy_chunk_${i}`;
        const sectionTitle = `Legacy chunk ${i}`;

        insertSection.run(sectionId, specId, sectionNumber, sectionTitle, text, text.length);
        inserted++;
        report.synthetic_sections++;
      }

      report.specs[specId] = { chunks: texts.length, inserted };
      insertIngestion.run(specId, inserted, JSON.stringify(warnings));
    }
  });

  migrate();
  return report;
}
