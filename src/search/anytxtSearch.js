/**
 * AnyTXT-based search retriever for 3-way RRF fusion.
 *
 * Uses AnyTXT Searcher's JSON-RPC API to search raw document files
 * on disk. Results are mapped back to DB sections by file path matching.
 *
 * This is an optional retriever. When AnyTXT is not running, it returns
 * an empty result set and the fusion degrades gracefully to 2-way RRF.
 */

import { searchFiles, checkAvailability, getAvailabilityStatus } from '../anytxt/client.js';
import { getConnection } from '../db/connection.js';

let available = false;

/**
 * Map a raw file path to the spec_id used in the database.
 * E.g. "C:\...\raw\ts_24_501_v19.5.0.pdf" → "ts_24_501"
 */
function specIdFromPath(filePath) {
  const fileName = filePath.replace(/.*[/\\]/, '').toLowerCase();
  const match = fileName.match(/^((?:ts|tr)_\d+_\d+(?:-\d+)?)/);
  return match ? match[1] : null;
}

/**
 * Resolve an AnyTXT search hit to section rows in our DB.
 * AnyTXT returns file-level results; we expand to matching sections
 * by looking up the spec_id and filtering by snippet content overlap.
 */
function resolveToSections(anytxtFiles, parsedQuery) {
  if (!anytxtFiles.length) return [];

  const db = getConnection();
  const results = [];
  const seen = new Set();
  const queryTerms = (parsedQuery.normalizedText || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  for (const file of anytxtFiles) {
    const specId = specIdFromPath(file.path);
    if (!specId) continue;

    const sections = db.prepare(`
      SELECT
        s.id as section_id,
        s.spec_id,
        s.section_number,
        s.section_title,
        s.depth,
        s.parent_section,
        p.section_number as parent_section_number,
        p.section_title as parent_section_title,
        s.page_start,
        s.page_end,
        s.content_length
      FROM sections s
      LEFT JOIN sections p ON p.id = s.parent_section
      WHERE s.spec_id = ?
      ORDER BY s.section_number
    `).all(specId);

    for (const section of sections) {
      if (seen.has(section.section_id)) continue;

      const titleMatch = queryTerms.some(term =>
        (section.section_title || '').toLowerCase().includes(term)
      );

      const snippetTerms = (file.snippet || '').toLowerCase();
      const snippetOverlap = queryTerms.filter(term => snippetTerms.includes(term)).length;

      if (titleMatch || snippetOverlap >= queryTerms.length * 0.5) {
        seen.add(section.section_id);
        results.push({
          section_id: section.section_id,
          spec_id: section.spec_id,
          section_number: section.section_number,
          section_title: section.section_title,
          depth: section.depth,
          parent_section: section.parent_section,
          parent_section_number: section.parent_section_number,
          parent_section_title: section.parent_section_title,
          page_start: section.page_start,
          page_end: section.page_end,
          content_length: section.content_length,
          snippet: file.snippet,
          anytxt_score: titleMatch ? 1.0 : snippetOverlap / Math.max(queryTerms.length, 1),
          evidence: ['anytxt'],
        });
      }
    }
  }

  return results;
}

export function isAnytxtAvailable() {
  return available;
}

export async function detectAnytxt() {
  available = await checkAvailability();
  return available;
}

export function getAnytxtStatus() {
  return {
    available,
    rpcStatus: getAvailabilityStatus(),
  };
}

export async function anytxtSearch(parsedQuery, rawDir = '', options = {}) {
  const {
    limit = 100,
    filterExt = '*.pdf',
  } = options;

  if (!available) return [];

  const pattern = parsedQuery.normalizedText || parsedQuery.raw;
  if (!pattern || !pattern.trim()) return [];

  const searchResult = await searchFiles(pattern, {
    filterDir: rawDir,
    filterExt,
    limit,
  });

  if (!searchResult.ok || !searchResult.files.length) return [];

  return resolveToSections(searchResult.files, parsedQuery);
}
