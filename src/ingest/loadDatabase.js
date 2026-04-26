/**
 * Load structured section JSONL files (from Python extraction scripts)
 * into the SQLite corpus database.
 *
 * Expects files named {spec_id}_sections.jsonl and optionally
 * {spec_id}_structure.jsonl in the intermediate directory.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getConnection } from '../db/connection.js';
import {
  normalizeSpecId,
  generateBrief,
  sectionDepth,
  getParentSectionId,
} from './sectionNormalizer.js';

/**
 * @typedef {Object} LoadResults
 * @property {number} specs
 * @property {number} sections
 * @property {number} toc_entries
 * @property {Array<{specId: string, sectionId: string, error: string}>} errors
 */

/**
 * Load structured section JSONL files into SQLite.
 *
 * @param {string} intermediateDir — Directory containing *_sections.jsonl files.
 * @param {string} dbPath          — Path to the SQLite database.
 * @param {{ strict?: boolean, specFilter?: string | null }} [options]
 * @returns {LoadResults}
 */
export function loadStructuredSections(intermediateDir, dbPath, options = {}) {
  const db = getConnection(dbPath);
  const strict = options.strict || false;
  const specFilter = options.specFilter || null;

  // --- Prepared statements --------------------------------------------------

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
      (id, spec_id, section_number, section_title, page_start, page_end, content, content_length, parent_section, depth)
    VALUES (@id, @spec_id, @section_number, @section_title, @page_start, @page_end, @content, @content_length, @parent_section, @depth)
  `);

  const insertIngestion = db.prepare(`
    INSERT INTO ingestion_runs (spec_id, source_type, rows_inserted, warnings, completed_at)
    VALUES (?, 'pdf_extraction', ?, ?, datetime('now'))
  `);

  // --- Discover files -------------------------------------------------------

  let files = readdirSync(intermediateDir)
    .filter(f => f.endsWith('_sections.jsonl'))
    .sort();

  if (specFilter) {
    const norm = normalizeSpecId(specFilter);
    files = files.filter(f => f.includes(norm) || f.includes(specFilter));
  }

  if (files.length === 0) {
    throw new Error(`No _sections.jsonl files found in ${intermediateDir}`);
  }

  /** @type {LoadResults} */
  const results = { specs: 0, sections: 0, toc_entries: 0, errors: [] };

  for (const file of files) {
    const filePath = join(intermediateDir, file);
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const sections = lines.map(l => JSON.parse(l));

    if (sections.length === 0) continue;

    const specId = sections[0].spec_id;
    const warnings = [];
    let sectionCount = 0;
    let tocEntries = [];

    const loadSpec = db.transaction(() => {
      // --- Read optional structure file for spec metadata & TOC -----------
      const structFile = file.replace('_sections.jsonl', '_structure.jsonl');
      const structPath = join(intermediateDir, structFile);
      let specMeta = null;

      try {
        const structLines = readFileSync(structPath, 'utf-8').split('\n').filter(Boolean);
        for (const line of structLines) {
          const record = JSON.parse(line);
          if (record.type === 'spec_meta') specMeta = record;
          if (record.type === 'toc_entry') tocEntries.push(record);
        }
      } catch {
        warnings.push(`Structure file not found: ${structFile}`);
      }

      // --- Insert spec row ------------------------------------------------
      insertSpec.run({
        id: specId,
        title: specMeta?.title || specId,
        version: specMeta?.version || null,
        series: specId.match(/ts_(\d+)_/)?.[1] || null,
        description: `3GPP ${specId.replace(/_/g, ' ').toUpperCase()}`,
        total_sections: sections.length,
        total_pages: specMeta?.total_pages || 0,
        source_pdf: specMeta?.source_pdf || null,
      });
      results.specs++;

      // --- Insert TOC entries --------------------------------------------
      for (let i = 0; i < tocEntries.length; i++) {
        const toc = tocEntries[i];
        if (!toc.section_number) continue;

        try {
          insertToc.run({
            spec_id: specId,
            section_number: toc.section_number,
            section_title: toc.title || '',
            page: toc.page || 0,
            depth: (toc.level || 1) - 1,
            brief: null, // filled later from section content
            sort_order: toc.sort_order ?? i,
          });
          results.toc_entries++;
        } catch (e) {
          warnings.push(`TOC insert failed: ${toc.section_number}: ${e.message}`);
        }
      }

      // --- Insert sections ------------------------------------------------
      for (const section of sections) {
        if (!section.content && strict) {
          warnings.push(`Empty content: ${section.section_id}`);
          continue;
        }

        const content = section.content || '';
        const sectionId = section.section_id || `${specId}:${section.section_number}`;
        const depth = section.depth ?? sectionDepth(section.section_number);
        const parentId = section.parent_section
          ? (section.parent_section.includes(':') ? section.parent_section : `${specId}:${section.parent_section}`)
          : getParentSectionId(sectionId);

        try {
          insertSection.run({
            id: sectionId,
            spec_id: specId,
            section_number: section.section_number,
            section_title: section.section_title || '',
            page_start: section.page_start || 0,
            page_end: section.page_end || 0,
            content,
            content_length: content.length,
            parent_section: parentId,
            depth,
          });
          sectionCount++;
          results.sections++;
        } catch (e) {
          warnings.push(`Section insert failed: ${sectionId}: ${e.message}`);
          results.errors.push({ specId, sectionId, error: e.message });
        }
      }

      // --- Back-fill TOC briefs from section content ----------------------
      const updateBrief = db.prepare(
        `UPDATE toc SET brief = ? WHERE spec_id = ? AND section_number = ?`
      );
      for (const section of sections) {
        if (section.brief || section.content) {
          const brief = section.brief || generateBrief(section.content);
          updateBrief.run(brief, specId, section.section_number);
        }
      }

      insertIngestion.run(specId, sectionCount, JSON.stringify(warnings));
    });

    loadSpec();
    console.log(`  ${specId}: ${sectionCount} sections, ${tocEntries.length} TOC entries`);
  }

  return results;
}
