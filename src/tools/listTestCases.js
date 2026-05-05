import { getConnection } from '../db/connection.js';
import { formatSuccess, formatError } from './helpers.js';

export const listTestCasesSchema = {
  name: 'list_test_cases',
  description: 'List structured 3GPP conformance test case sections for a specification, with optional section-prefix filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      specId: { type: 'string', description: "Spec ID (e.g. 'ts_38_523_1')" },
      sectionPrefix: { type: 'string', description: "Filter by section prefix (e.g. '6.1' for only section 6.1 TCs)" },
      maxResults: { type: 'number', description: 'Max results (default: 50)' },
    },
    required: ['specId'],
  },
};

function buildWhere(sectionPrefix) {
  const where = ['spec_id = ?', "section_number LIKE '6.%'", 'depth >= 4'];
  const params = [];

  if (sectionPrefix) {
    where.push('(section_number = ? OR section_number LIKE ?)');
    params.push(sectionPrefix, `${sectionPrefix}.%`);
  }

  return { where: where.join(' AND '), params };
}

function toTestCase(row) {
  const content = row.content || '';
  return {
    section_id: row.id,
    section_number: row.section_number,
    section_title: row.section_title,
    page_start: row.page_start,
    page_end: row.page_end,
    content_length: row.content_length,
    has_test_purpose: /\bTest Purpose(?:\s*\(TP\))?\b/i.test(content),
    has_test_procedure: /\bTest procedure(?: sequence)?\b/i.test(content),
    appears_valid_tc: /\bTest Purpose(?:\s*\(TP\))?\b/i.test(content) || /\bTest description\b/i.test(content),
  };
}

export function handleListTestCases(args) {
  try {
    const db = getConnection();
    const { specId, sectionPrefix, maxResults = 50 } = args;

    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sections
      WHERE spec_id = ?
        AND section_number LIKE '6.%'
        AND depth >= 4
    `).get(specId).count;

    const { where, params } = buildWhere(sectionPrefix);
    const filteredCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sections
      WHERE ${where}
    `).get(specId, ...params).count;

    const rows = db.prepare(`
      SELECT id, section_number, section_title, page_start, page_end, content_length, content
      FROM sections
      WHERE ${where}
      ORDER BY section_number
      LIMIT ?
    `).all(specId, ...params, maxResults);

    return formatSuccess({
      spec_id: specId,
      total_test_cases: total,
      filtered_count: filteredCount,
      test_cases: rows.map(toTestCase),
    });
  } catch (error) {
    console.error('[list_test_cases] Error:', error.message, { args });
    return formatError({
      error: error.message,
      tool: 'list_test_cases',
      context: { args },
    });
  }
}
