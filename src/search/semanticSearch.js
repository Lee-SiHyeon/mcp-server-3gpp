import { getConnection } from '../db/connection.js';

/**
 * Check if vector search is available.
 */
export function isVectorSearchAvailable() {
  try {
    const db = getConnection();
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_sections'"
    ).get();
    if (!result) return false;

    const count = db.prepare('SELECT count(*) as c FROM vec_sections').get();
    return count.c > 0;
  } catch {
    return false;
  }
}

/**
 * Perform vector similarity search.
 * @param {Float32Array|Buffer} queryVector - 384-dim query embedding
 * @param {number} limit - Max results
 * @param {string} [specFilter] - Optional spec filter
 * @returns {Array<{section_id: string, spec_id: string, section_number: string, section_title: string, distance: number, semantic_score: number}>}
 */
export function semanticSearch(queryVector, limit = 30, specFilter = null) {
  if (!isVectorSearchAvailable()) return [];

  const db = getConnection();

  try {
    let sql = `
      SELECT 
        v.section_id,
        v.distance,
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
      FROM vec_sections v
      JOIN sections s ON s.id = v.section_id
      LEFT JOIN sections p ON p.id = s.parent_section
      WHERE v.embedding MATCH ?
    `;
    const params = [queryVector];

    if (specFilter) {
      sql += ` AND s.spec_id = ?`;
      params.push(specFilter);
    }

    sql += ` ORDER BY v.distance LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    if (rows.length === 0) return [];
    const maxDist = Math.max(...rows.map(r => r.distance)) || 1;

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
      distance: row.distance,
      semantic_score: Math.max(0, 1 - (row.distance / maxDist)),
    }));
  } catch (e) {
    console.error(`Vector search failed: ${e.message}`);
    return [];
  }
}
