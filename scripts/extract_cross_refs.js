#!/usr/bin/env node
/**
 * extract_cross_refs.js
 *
 * Scans all sections in 3gpp.db looking for cross-spec citation patterns:
 *   - 3GPP TS xx.xxx  → ts_XX_XXX
 *   - 3GPP TR xx.xxx  → tr_XX_XXX
 *   - RFC NNNN / RFC-NNNN → rfc_NNNN
 *
 * Creates/populates the `spec_references` table.
 *
 * Usage:
 *   node scripts/extract_cross_refs.js [--db /path/to/3gpp.db] [--verbose]
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dbPath = (() => {
  const i = args.indexOf('--db');
  return i >= 0 ? args[i + 1] : path.join(PROJECT_ROOT, 'data', 'corpus', '3gpp.db');
})();
const verbose = args.includes('--verbose');

// ---------------------------------------------------------------------------
// Normalise a spec string to canonical DB id
// "TS 24.301" → "ts_24_301",  "TR 21.905" → "tr_21_905"
// "24.301"    → "ts_24_301" (default TS)
// ---------------------------------------------------------------------------
function normaliseSpecId(type, num) {
  const prefix = (type || 'ts').toLowerCase();
  const normalised = num.replace(/\./g, '_');
  return `${prefix}_${normalised}`;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------
const PATTERNS = [
  // 3GPP TS / TR with optional full spec number "3GPP TS 24.301" or "TS 24.301"
  {
    re: /(?:3GPP\s+)?(TS|TR)\s+(\d{2,3}\.\d{3})/gi,
    extract: (m) => ({ ref_type: '3gpp', target_id: normaliseSpecId(m[1], m[2]), citation_text: m[0].trim() }),
  },
  // RFC NNNN or RFC-NNNN
  {
    re: /\bRFC[\s\-–](\d{3,5})\b/gi,
    extract: (m) => ({ ref_type: 'rfc', target_id: `rfc_${m[1]}`, citation_text: m[0].trim() }),
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS spec_references (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      source_spec_id TEXT    NOT NULL,
      target_spec_id TEXT    NOT NULL,
      ref_type       TEXT    NOT NULL,       -- '3gpp' | 'rfc'
      citation_text  TEXT,
      section_id     TEXT,
      in_corpus      INTEGER DEFAULT 0,      -- 1 if target_spec_id exists in specs
      UNIQUE(source_spec_id, target_spec_id, section_id)
    );
    CREATE INDEX IF NOT EXISTS idx_specref_source ON spec_references(source_spec_id);
    CREATE INDEX IF NOT EXISTS idx_specref_target ON spec_references(target_spec_id);
  `);

  // Load all spec IDs in corpus for in_corpus flag
  const inCorpus = new Set(db.prepare('SELECT id FROM specs').all().map(r => r.id));

  // Count rows
  const totalSections = db.prepare('SELECT COUNT(*) as c FROM sections').get().c;
  console.error(`[cross-ref] Scanning ${totalSections} sections in ${dbPath}`);

  // Truncate existing refs for a clean rebuild
  db.prepare('DELETE FROM spec_references').run();

  // Iterate sections in batches
  const BATCH = 500;
  let offset = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO spec_references
      (source_spec_id, target_spec_id, ref_type, citation_text, section_id, in_corpus)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      const result = insertStmt.run(
        r.source_spec_id, r.target_spec_id, r.ref_type,
        r.citation_text, r.section_id, r.in_corpus
      );
      if (result.changes > 0) totalInserted++;
      else totalSkipped++;
    }
  });

  while (offset < totalSections) {
    const batch = db.prepare(
      'SELECT id, spec_id, content FROM sections LIMIT ? OFFSET ?'
    ).all(BATCH, offset);
    offset += BATCH;

    const rows = [];
    for (const section of batch) {
      const seen = new Set(); // deduplicate per section

      for (const { re, extract } of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(section.content)) !== null) {
          const ref = extract(m);
          // Skip self-references
          if (ref.target_id === section.spec_id) continue;
          const key = `${ref.target_id}:${section.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          rows.push({
            source_spec_id: section.spec_id,
            target_spec_id: ref.target_id,
            ref_type:       ref.ref_type,
            citation_text:  ref.citation_text,
            section_id:     section.id,
            in_corpus:      inCorpus.has(ref.target_id) ? 1 : 0,
          });
        }
      }
    }

    insertMany(rows);

    if (verbose) {
      process.stderr.write(`[cross-ref] processed ${offset}/${totalSections}\r`);
    }
  }

  if (verbose) process.stderr.write('\n');

  // Summary stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_refs,
      COUNT(DISTINCT source_spec_id) as sources,
      COUNT(DISTINCT target_spec_id) as targets,
      SUM(in_corpus) as in_corpus_count
    FROM spec_references
  `).get();

  console.error(`[cross-ref] Done!`);
  console.error(`  Total reference rows : ${stats.total_refs}`);
  console.error(`  Source specs         : ${stats.sources}`);
  console.error(`  Unique targets cited : ${stats.targets}`);
  console.error(`  Targets in corpus    : ${stats.in_corpus_count}`);

  // Top 10 most referenced specs
  const topReferenced = db.prepare(`
    SELECT target_spec_id, COUNT(*) as mention_count, MAX(in_corpus) as in_corpus
    FROM spec_references
    GROUP BY target_spec_id
    ORDER BY mention_count DESC
    LIMIT 10
  `).all();

  console.error('\n[cross-ref] Most referenced specs:');
  for (const r of topReferenced) {
    const marker = r.in_corpus ? '✓' : '○';
    console.error(`  ${marker} ${r.target_spec_id.padEnd(20)} ${r.mention_count} mentions`);
  }

  db.close();
}

main();
