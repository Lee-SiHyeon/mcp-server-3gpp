/**
 * Shared database queries — extracted from tool handlers to reduce duplication.
 *
 * Only queries that appear in 2+ handlers live here. Handler-specific queries
 * (e.g., neighbor lookups in getSection, reference joins in getSpecReferences)
 * remain inline in their respective files.
 */

import { getConnection } from './connection.js';

/**
 * Fetch a full section row by its composite ID (e.g. "ts_24_301:5.5.1.2.5").
 * @param {string} sectionId
 * @returns {object|undefined}
 */
export function getSectionById(sectionId) {
  const db = getConnection();
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
}

/**
 * Fetch a spec's id and title.
 * @param {string} specId
 * @returns {{id: string, title: string}|undefined}
 */
export function getSpecById(specId) {
  const db = getConnection();
  return db.prepare('SELECT id, title FROM specs WHERE id = ?').get(specId);
}

/**
 * Return all spec IDs in alphabetical order.
 * @returns {string[]}
 */
export function getAllSpecIds() {
  const db = getConnection();
  return db.prepare('SELECT id FROM specs ORDER BY id').all().map(s => s.id);
}

/**
 * Suggest sections that start with a given prefix within a spec.
 * Used when a requested section ID is not found.
 * @param {string} specPart  — the spec portion of the section ID
 * @param {string} numPrefix — beginning of the section number
 * @param {number} [limit=5]
 * @returns {Array<{id: string, section_title: string}>}
 */
export function getSectionSuggestions(specPart, numPrefix, limit = 5) {
  const db = getConnection();
  return db.prepare(
    'SELECT id, section_title FROM sections WHERE spec_id = ? AND section_number LIKE ? LIMIT ?'
  ).all(specPart, `${numPrefix}%`, limit);
}

/**
 * Fetch immediate child sections for a structural section.
 * Includes TOC briefs when available so callers can present navigation hints.
 * @param {string} sectionId
 * @param {number} [limit=12]
 * @returns {Array<object>}
 */
export function getSectionChildren(sectionId, limit = 12) {
  const db = getConnection();
  return db.prepare(`
    SELECT
      s.id,
      s.spec_id,
      s.section_number,
      s.section_title,
      s.content_length,
      s.page_start,
      s.page_end,
      s.depth,
      t.brief
    FROM sections s
    LEFT JOIN toc t
      ON t.spec_id = s.spec_id
     AND t.section_number = s.section_number
    WHERE s.parent_section = ?
    ORDER BY s.section_number
    LIMIT ?
  `).all(sectionId, limit);
}

/**
 * Fetch the nearest contentful descendants underneath a structural section.
 * Ordered to prefer the shallowest useful descendants first.
 * @param {string} specId
 * @param {string} sectionNumber
 * @param {number} [limit=8]
 * @returns {Array<object>}
 */
export function getContentfulDescendants(specId, sectionNumber, limit = 8) {
  const db = getConnection();
  return db.prepare(`
    SELECT
      s.id,
      s.spec_id,
      s.section_number,
      s.section_title,
      s.content_length,
      s.page_start,
      s.page_end,
      s.depth,
      t.brief
    FROM sections s
    LEFT JOIN toc t
      ON t.spec_id = s.spec_id
     AND t.section_number = s.section_number
    WHERE s.spec_id = ?
      AND s.section_number LIKE ?
      AND s.content_length > 0
    ORDER BY s.depth, s.page_start, s.section_number
    LIMIT ?
  `).all(specId, `${sectionNumber}.%`, limit);
}

/**
 * Count contentful descendants underneath a structural section.
 * @param {string} specId
 * @param {string} sectionNumber
 * @returns {number}
 */
export function countContentfulDescendants(specId, sectionNumber) {
  const db = getConnection();
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sections
    WHERE spec_id = ?
      AND section_number LIKE ?
      AND content_length > 0
  `).get(specId, `${sectionNumber}.%`);
  return row?.count ?? 0;
}

/**
 * Fetch a section by spec + section number.
 * @param {string} specId
 * @param {string} sectionNumber
 * @returns {object|undefined}
 */
export function getSectionByNumber(specId, sectionNumber) {
  const db = getConnection();
  return db.prepare('SELECT * FROM sections WHERE spec_id = ? AND section_number = ?').get(specId, sectionNumber);
}

/**
 * Fetch contentful sections in the same spec with the exact same title.
 * Useful when a structural heading and a later definition clause share a title.
 * @param {string} specId
 * @param {string} sectionTitle
 * @param {number} [limit=5]
 * @returns {Array<object>}
 */
export function getContentfulSectionsByTitle(specId, sectionTitle, limit = 5) {
  const db = getConnection();
  return db.prepare(`
    SELECT
      id,
      spec_id,
      section_number,
      section_title,
      page_start,
      page_end,
      content_length,
      substr(content, 1, 240) AS snippet,
      parent_section,
      depth
    FROM sections
    WHERE spec_id = ?
      AND section_title = ?
      AND content_length > 0
    ORDER BY depth, page_start, section_number
    LIMIT ?
  `).all(specId, sectionTitle, limit);
}

/**
 * Suggest spec IDs that contain a substring (fuzzy match).
 * @param {string} specId — partial spec ID entered by the user
 * @param {number} [limit=5]
 * @returns {string[]}
 */
export function getSpecSuggestions(specId, limit = 5) {
  const db = getConnection();
  const escaped = specId.replace(/[%_^]/g, '^$&');
  return db.prepare(
    "SELECT id FROM specs WHERE id LIKE ? ESCAPE '^' LIMIT ?"
  ).all(`%${escaped}%`, limit).map(r => r.id);
}
