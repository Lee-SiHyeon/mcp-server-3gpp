import { getConnection } from '../db/connection.js';
import { getSpecById, getAllSpecIds } from '../db/queries.js';
import { formatSuccess, formatError } from './helpers.js';

export const getSpecTocSchema = {
  name: 'get_spec_toc',
  description: 'Get the table of contents (section hierarchy) for a specific 3GPP specification. Returns section numbers, titles, page numbers, and brief descriptions. Use after get_spec_catalog to explore a spec before fetching full sections.',
  inputSchema: {
    type: 'object',
    properties: {
      specId: { type: 'string', description: 'Spec identifier (e.g., "ts_24_301")' },
      maxDepth: { type: 'number', description: 'Maximum depth level (default: 4)' },
      sectionPrefix: { type: 'string', description: 'Filter to subtree (e.g., "5.5")' },
      includeBriefs: { type: 'boolean', description: 'Include brief descriptions (default: true)' },
    },
    required: ['specId'],
  },
};

export function handleGetSpecToc(args) {
  const db = getConnection();
  const { specId, maxDepth = 4, sectionPrefix, includeBriefs = true } = args;

  const spec = getSpecById(specId);
  if (!spec) {
    return formatError({
      error: `Spec not found: ${specId}`,
      available_specs: getAllSpecIds(),
    });
  }

  let sql = `SELECT section_number, section_title, page, depth${includeBriefs ? ', brief' : ''} FROM toc WHERE spec_id = ?`;
  const params = [specId];

  if (maxDepth !== undefined) {
    sql += ' AND depth < ?';
    params.push(maxDepth);
  }

  if (sectionPrefix) {
    sql += ' AND (section_number = ? OR section_number LIKE ?)';
    params.push(sectionPrefix, `${sectionPrefix}.%`);
  }

  sql += ' ORDER BY sort_order, section_number';

  const entries = db.prepare(sql).all(...params);

  // If no TOC entries, try sections table as fallback
  if (entries.length === 0) {
    let fallbackSql = 'SELECT section_number, section_title, page_start as page, depth FROM sections WHERE spec_id = ?';
    const fbParams = [specId];
    if (sectionPrefix) {
      fallbackSql += ' AND (section_number = ? OR section_number LIKE ?)';
      fbParams.push(sectionPrefix, `${sectionPrefix}.%`);
    }
    fallbackSql += ' ORDER BY section_number LIMIT 100';
    const fbEntries = db.prepare(fallbackSql).all(...fbParams);
    return formatSuccess({ spec_id: specId, title: spec.title, entries: fbEntries, source: 'sections_fallback' });
  }

  return formatSuccess({ spec_id: specId, title: spec.title, entries });
}
