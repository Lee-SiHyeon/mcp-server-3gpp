import { getConnection } from '../db/connection.js';

const TITLE_WEIGHT = 10.0;
const CONTENT_WEIGHT = 1.0;

/**
 * Perform FTS5 keyword search with BM25 ranking.
 * @param {object} parsed - Output from parseQuery
 * @returns {Array<{section_id: string, spec_id: string, section_number: string, section_title: string, keyword_score: number, snippet: string}>}
 */
export function keywordSearch(parsed) {
  const db = getConnection();

  // Build FTS5 query
  const parts = [];

  for (const phrase of parsed.phrases) {
    parts.push(`"${phrase}"`);
  }

  for (const term of parsed.terms) {
    parts.push(term);
  }

  for (const neg of parsed.negatedTerms) {
    parts.push(`NOT ${neg}`);
  }

  const ftsQuery = parts.join(' ');
  if (!ftsQuery.trim()) return [];

  // Build SQL with optional spec filter
  let sql = `
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
      s.content_length,
      bm25(sections_fts, ${TITLE_WEIGHT}, ${CONTENT_WEIGHT}) as raw_bm25,
      snippet(sections_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM sections_fts
    JOIN sections s ON s.rowid = sections_fts.rowid
    LEFT JOIN sections p ON p.id = s.parent_section
    WHERE sections_fts MATCH ?
  `;
  const params = [ftsQuery];

  if (parsed.specFilter) {
    sql += ` AND s.spec_id = ?`;
    params.push(parsed.specFilter);
  }

  sql += ` ORDER BY bm25(sections_fts, ${TITLE_WEIGHT}, ${CONTENT_WEIGHT}) LIMIT ?`;
  params.push(parsed.k * 3);

  try {
    return normalizeResults(db.prepare(sql).all(...params));
  } catch (e) {
    // FTS parse error — try simpler query
    console.error(`FTS query failed: ${e.message}, trying simple search`);
    const simpleQuery = parsed.normalizedText.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    if (!simpleQuery) return [];

    params[0] = simpleQuery;
    try {
      return normalizeResults(db.prepare(sql).all(...params));
    } catch (e2) {
      throw new Error(`Search query syntax error. Try simpler terms. (${e2.message})`);
    }
  }
}

/**
 * Normalize BM25 scores to [0,1].
 * BM25 returns negative values (more negative = better match).
 */
function normalizeResults(rows) {
  if (rows.length === 0) return [];

  const minBm25 = Math.min(...rows.map(r => r.raw_bm25));
  const maxBm25 = Math.max(...rows.map(r => r.raw_bm25));
  const range = maxBm25 - minBm25 || 1;

  return rows.map(row => ({
    section_id: row.section_id,
    spec_id: row.spec_id,
    section_number: row.section_number,
    section_title: row.section_title,
    depth: row.depth,
    parent_section: row.parent_section,
    parent_section_number: row.parent_section_number,
    parent_section_title: row.parent_section_title,
    page_start: row.page_start,
    page_end: row.page_end,
    content_length: row.content_length,
    snippet: row.snippet,
    keyword_score: Math.max(0, Math.min(1, (maxBm25 - row.raw_bm25) / range)),
    raw_bm25: row.raw_bm25,
  }));
}
