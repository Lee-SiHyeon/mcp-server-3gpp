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
