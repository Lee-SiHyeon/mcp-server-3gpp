import { getConnection } from '../db/connection.js';

export const listSpecsSchema = {
  name: 'list_specs',
  description: 'List all available 3GPP specifications with section counts. Legacy compatibility tool — prefer get_spec_catalog for richer metadata.',
  inputSchema: { type: 'object', properties: {} },
};

export function handleListSpecs() {
  const db = getConnection();
  const specs = db.prepare(
    'SELECT id as spec_id, title, total_sections as count FROM specs ORDER BY id'
  ).all();

  return { content: [{ type: 'text', text: JSON.stringify({ specs }, null, 2) }] };
}
