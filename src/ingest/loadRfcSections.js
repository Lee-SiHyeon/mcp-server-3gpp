/**
 * Load RFC sections from JSONL files into the SQLite corpus database.
 *
 * Reads rfc_{NNNN}_sections.jsonl and rfc_{NNNN}_toc.jsonl from the
 * intermediate directory and inserts them into the shared specs / toc /
 * sections tables.
 *
 * FTS is maintained automatically by the sections_ai / sections_au /
 * sections_ad triggers — no manual FTS insertion required.
 *
 * Usage:
 *   node src/ingest/loadRfcSections.js --rfc 3261
 *   node src/ingest/loadRfcSections.js --rfc 3261 --rfc 6733 --rfc 8446
 *   node src/ingest/loadRfcSections.js --all
 *   node src/ingest/loadRfcSections.js --rfc 3261 --rebuild
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getConnection, closeConnection } from '../db/connection.js';
import { generateBrief, sectionDepth, getParentSectionId } from './sectionNormalizer.js';

// Resolve project root: this file lives at src/ingest/loadRfcSections.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PROJECT_ROOT = resolve(__dirname);
const INTERMEDIATE_DIR = join(PROJECT_ROOT, 'data', 'intermediate');
const RFCS_DIR = join(PROJECT_ROOT, 'data', 'rfcs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSONL file and return parsed objects. Returns [] if file not found.
 * @param {string} filePath
 * @returns {object[]}
 */
function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/**
 * Read RFC metadata JSON file. Returns {} if not found.
 * @param {number} rfcNumber
 * @returns {object}
 */
function readMeta(rfcNumber) {
  const metaPath = join(RFCS_DIR, `rfc${rfcNumber}_meta.json`);
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Derive RFC number from a spec_id like "rfc_3261" or from a filename.
 * @param {string} specId  e.g. "rfc_3261"
 * @returns {number | null}
 */
function rfcNumberFromSpecId(specId) {
  const m = specId.match(/^rfc_(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Discover all RFC section JSONL files in the intermediate directory.
 * @returns {number[]} sorted RFC numbers
 */
function discoverRfcNumbers() {
  if (!existsSync(INTERMEDIATE_DIR)) return [];
  const files = readdirSync(INTERMEDIATE_DIR)
    .filter(f => /^rfc_\d+_sections\.jsonl$/.test(f));
  return files
    .map(f => {
      const m = f.match(/^rfc_(\d+)_sections\.jsonl$/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(Boolean)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load a single RFC into the database.
 *
 * @param {number} rfcNumber
 * @param {import('better-sqlite3').Database} db
 * @param {{ rebuild?: boolean }} options
 * @returns {{ sections: number, tocEntries: number, skipped: boolean }}
 */
function loadRfc(rfcNumber, db, options = {}) {
  const specId = `rfc_${rfcNumber}`;
  const rebuild = options.rebuild || false;

  // --- Check if already ingested (skip unless --rebuild) ------------------
  if (!rebuild) {
    const existing = db.prepare(
      `SELECT id FROM ingestion_runs WHERE spec_id = ? AND source_type = 'rfc' LIMIT 1`
    ).get(specId);
    if (existing) {
      console.log(`  ${specId}: already loaded (use --rebuild to re-ingest)`);
      return { sections: 0, tocEntries: 0, skipped: true };
    }
  }

  // --- Read JSONL files ---------------------------------------------------
  const sectionsPath = join(INTERMEDIATE_DIR, `rfc_${rfcNumber}_sections.jsonl`);
  const tocPath = join(INTERMEDIATE_DIR, `rfc_${rfcNumber}_toc.jsonl`);

  const sections = readJsonl(sectionsPath);
  const tocEntries = readJsonl(tocPath);
  const meta = readMeta(rfcNumber);

  if (sections.length === 0 && tocEntries.length === 0) {
    console.log(`  ${specId}: no data files found — run extract_rfc_structure.py first`);
    return { sections: 0, tocEntries: 0, skipped: true };
  }

  // --- Prepared statements ------------------------------------------------
  const insertSpec = db.prepare(`
    INSERT OR REPLACE INTO specs
      (id, title, version, series, description, total_sections, total_pages, source_pdf)
    VALUES (@id, @title, @version, @series, @description, @total_sections, @total_pages, @source_pdf)
  `);

  const insertToc = db.prepare(`
    INSERT OR REPLACE INTO toc
      (spec_id, section_number, section_title, page, depth, brief, sort_order)
    VALUES (@spec_id, @section_number, @section_title, @page, @depth, @brief, @sort_order)
  `);

  const insertSection = db.prepare(`
    INSERT OR REPLACE INTO sections
      (id, spec_id, section_number, section_title, page_start, page_end,
       content, content_length, parent_section, depth)
    VALUES (@id, @spec_id, @section_number, @section_title, @page_start, @page_end,
            @content, @content_length, @parent_section, @depth)
  `);

  const insertIngestion = db.prepare(`
    INSERT INTO ingestion_runs (spec_id, source_type, rows_inserted, warnings, completed_at)
    VALUES (?, 'rfc', ?, ?, datetime('now'))
  `);

  const warnings = [];
  let sectionCount = 0;
  let tocCount = 0;

  // --- Wrap everything in a transaction for atomicity ---------------------
  const doLoad = db.transaction(() => {
    // If rebuilding, remove existing data first
    if (rebuild) {
      db.prepare(`DELETE FROM sections WHERE spec_id = ?`).run(specId);
      db.prepare(`DELETE FROM toc WHERE spec_id = ?`).run(specId);
      db.prepare(`DELETE FROM specs WHERE id = ?`).run(specId);
      db.prepare(
        `DELETE FROM ingestion_runs WHERE spec_id = ? AND source_type = 'rfc'`
      ).run(specId);
      console.log(`  ${specId}: cleared existing data`);
    }

    // --- Determine spec metadata ------------------------------------------
    const title = meta.title || `RFC ${rfcNumber}`;
    // version: use RFC date from metadata e.g. "June 2022"
    const version = meta.date
      ? meta.date.replace(/T.*$/, '').trim()  // trim ISO datetime to date
      : null;
    const totalPages = meta.pages || 0;
    const sourceUrl = meta.url || `https://www.rfc-editor.org/rfc/rfc${rfcNumber}.txt`;

    insertSpec.run({
      id: specId,
      title,
      version,
      series: null,  // series is 3GPP-specific
      description: `RFC ${rfcNumber}: ${title}`,
      total_sections: sections.length,
      total_pages: totalPages,
      source_pdf: sourceUrl,
    });

    // --- Insert TOC entries -----------------------------------------------
    for (let i = 0; i < tocEntries.length; i++) {
      const toc = tocEntries[i];
      if (!toc.section_number) continue;
      try {
        insertToc.run({
          spec_id: specId,
          section_number: toc.section_number,
          section_title: toc.section_title || '',
          page: toc.page_estimate || 0,
          depth: toc.depth ?? sectionDepth(toc.section_number),
          brief: toc.brief || null,
          sort_order: i,
        });
        tocCount++;
      } catch (e) {
        warnings.push(`TOC insert failed ${toc.section_number}: ${e.message}`);
      }
    }

    // --- Insert sections --------------------------------------------------
    for (const section of sections) {
      const content = section.content || '';
      const depth = section.depth ?? sectionDepth(section.section_number);
      const parentId = section.parent_section || getParentSectionId(section.section_id) || null;
      const brief = section.brief || generateBrief(content);

      try {
        insertSection.run({
          id: section.section_id,
          spec_id: specId,
          section_number: section.section_number,
          section_title: section.section_title || '',
          page_start: section.page_start || 0,
          page_end: section.page_end || 0,
          content,
          content_length: content.length,
          parent_section: parentId || null,
          depth,
        });
        sectionCount++;
      } catch (e) {
        warnings.push(`Section insert failed ${section.section_id}: ${e.message}`);
      }
    }

    // --- Back-fill TOC briefs from section content -----------------------
    if (sectionCount > 0) {
      const updateBrief = db.prepare(
        `UPDATE toc SET brief = ? WHERE spec_id = ? AND section_number = ? AND brief IS NULL`
      );
      for (const section of sections) {
        if (section.brief || section.content) {
          const brief = section.brief || generateBrief(section.content);
          updateBrief.run(brief, specId, section.section_number);
        }
      }
    }

    // --- Record ingestion run ---------------------------------------------
    insertIngestion.run(specId, sectionCount, JSON.stringify(warnings));
  });

  doLoad();

  console.log(`  ${specId}: ${sectionCount} sections, ${tocCount} TOC entries loaded`);
  if (warnings.length > 0) {
    console.log(`  ${specId}: ${warnings.length} warnings`);
    warnings.slice(0, 5).forEach(w => console.log(`    ⚠ ${w}`));
    if (warnings.length > 5) {
      console.log(`    … and ${warnings.length - 5} more`);
    }
  }

  return { sections: sectionCount, tocEntries: tocCount, skipped: false };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const rfcNumbers = [];
  let loadAll = false;
  let rebuild = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rfc' && args[i + 1]) {
      rfcNumbers.push(parseInt(args[++i], 10));
    } else if (args[i] === '--all') {
      loadAll = true;
    } else if (args[i] === '--rebuild') {
      rebuild = true;
    }
  }

  return { rfcNumbers, loadAll, rebuild };
}

function main() {
  const { rfcNumbers, loadAll, rebuild } = parseArgs();

  let toLoad;
  if (loadAll) {
    toLoad = discoverRfcNumbers();
    if (toLoad.length === 0) {
      console.error('No rfc_*_sections.jsonl files found in', INTERMEDIATE_DIR);
      process.exit(1);
    }
    console.log(`Loading all ${toLoad.length} RFC(s) found in ${INTERMEDIATE_DIR}`);
  } else if (rfcNumbers.length > 0) {
    toLoad = rfcNumbers;
  } else {
    console.error('Usage: node src/ingest/loadRfcSections.js [--rfc 3261] [--all] [--rebuild]');
    process.exit(1);
  }

  const db = getConnection();
  console.log(`Database: data/corpus/3gpp.db`);
  console.log(`Mode: ${rebuild ? 'rebuild' : 'incremental'}\n`);

  let totalSections = 0;
  let totalToc = 0;
  let skipped = 0;

  for (const rfcNumber of toLoad) {
    const result = loadRfc(rfcNumber, db, { rebuild });
    if (result.skipped) {
      skipped++;
    } else {
      totalSections += result.sections;
      totalToc += result.tocEntries;
    }
  }

  closeConnection();

  console.log(`\n── Summary ──────────────────────────────────────`);
  console.log(`  RFCs processed : ${toLoad.length - skipped}`);
  console.log(`  RFCs skipped   : ${skipped}`);
  console.log(`  Sections loaded: ${totalSections}`);
  console.log(`  TOC entries    : ${totalToc}`);
  console.log(`─────────────────────────────────────────────────`);
}

main();
