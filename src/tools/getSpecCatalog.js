import { getConnection } from '../db/connection.js';
import { formatSuccess } from './helpers.js';

export const getSpecCatalogSchema = {
  name: 'get_spec_catalog',
  description: 'Get the catalog of all supported 3GPP specifications with metadata. Returns spec IDs, titles, versions, descriptions, section counts, and page totals. Use this first to discover available specs before drilling into TOC or sections.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional text filter for spec title or ID' },
      family: { type: 'string', description: 'Filter by series (e.g., "24", "36", "38")' },
    },
  },
};

export function handleGetSpecCatalog(args = {}) {
  const db = getConnection();
  let sql = 'SELECT id, title, version, series, description, total_sections, total_pages FROM specs';
  const conditions = [];
  const params = [];

  if (args.filter) {
    const escaped = args.filter.replace(/[%_^]/g, '^$&');
    conditions.push("(id LIKE ? ESCAPE '^' OR title LIKE ? ESCAPE '^')");
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  if (args.family) {
    conditions.push('series = ?');
    params.push(args.family);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY series, id';

  const specs = db.prepare(sql).all(...params);
  return formatSuccess({ specs });
}
