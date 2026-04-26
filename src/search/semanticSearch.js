import { getConnection } from '../db/connection.js';
import { getEmbeddingIndexStatus } from '../embeddings/indexMetadata.js';
import { serializeVector } from '../embeddings/serializeVector.js';

export function getVectorSearchStatus() {
  try {
    const db = getConnection();
    return getEmbeddingIndexStatus(db);
  } catch {
    return {
      available: false,
      reasons: ['db_unavailable'],
      sectionCount: 0,
      vecRowCount: 0,
      metadata: null,
      expected: null,
    };
  }
}

export function isVectorSearchAvailable() {
  return getVectorSearchStatus().available;
}

function coerceQueryVector(queryVector) {
  if (Buffer.isBuffer(queryVector)) return queryVector;
  if (queryVector instanceof Float32Array) return serializeVector(queryVector);
  throw new Error('queryVector must be a Buffer or Float32Array');
}

export function semanticSearch(queryVector, limit = 30, specFilter = null) {
  const status = getVectorSearchStatus();
  if (!status.available) return [];

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
    const params = [coerceQueryVector(queryVector)];

    if (specFilter) {
      sql += ' AND s.spec_id = ?';
      params.push(specFilter);
    }

    sql += ' AND k = ? ORDER BY v.distance';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    if (rows.length === 0) return [];
    const maxDist = Math.max(...rows.map((row) => row.distance)) || 1;

    return rows.map((row) => ({
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
  } catch (error) {
    console.error(`Vector search failed: ${error.message}`);
    return [];
  }
}
