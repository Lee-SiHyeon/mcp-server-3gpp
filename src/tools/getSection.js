import { getConnection } from '../db/connection.js';

export const getSectionSchema = {
  name: 'get_section',
  description: 'Fetch the full content of a specific 3GPP document section by section ID or spec+number. Returns section text, page range, and metadata. Use for deterministic content retrieval after discovering sections via TOC or search.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: 'Full section ID (e.g., "ts_24_301:5.5.1.2.5")' },
      specId: { type: 'string', description: 'Spec ID (use with sectionNumber)' },
      sectionNumber: { type: 'string', description: 'Section number (use with specId)' },
      includeNeighbors: { type: 'boolean', description: 'Include adjacent sections (default: false)' },
      neighborWindow: { type: 'number', description: 'Number of neighbors each side (default: 1)' },
      maxChars: { type: 'number', description: 'Max content length (truncates if exceeded)' },
    },
  },
};

export function handleGetSection(args) {
  const db = getConnection();
  let { sectionId, specId, sectionNumber, includeNeighbors = false, neighborWindow = 1, maxChars } = args;

  if (!sectionId && specId && sectionNumber) {
    sectionId = `${specId}:${sectionNumber}`;
  }

  if (!sectionId) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide sectionId or both specId and sectionNumber' }) }] };
  }

  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);

  if (!section) {
    const specPart = sectionId.split(':')[0];
    const numPart = sectionId.split(':')[1] || '';
    const suggestions = db.prepare(
      'SELECT id, section_title FROM sections WHERE spec_id = ? AND section_number LIKE ? LIMIT 5'
    ).all(specPart, `${numPart}%`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Section not found: ${sectionId}`,
          suggestions: suggestions.map(s => ({ id: s.id, title: s.section_title })),
        }),
      }],
    };
  }

  let content = section.content;
  let truncated = false;
  if (maxChars && content.length > maxChars) {
    content = content.substring(0, maxChars);
    truncated = true;
  }

  const result = {
    section: {
      section_id: section.id,
      spec_id: section.spec_id,
      section_number: section.section_number,
      section_title: section.section_title,
      page_start: section.page_start,
      page_end: section.page_end,
      parent_section: section.parent_section,
      content,
      content_length: section.content_length,
      ...(truncated ? { truncated: true } : {}),
    },
  };

  if (includeNeighbors) {
    const neighbors = db.prepare(`
      SELECT id, section_number, section_title FROM sections
      WHERE spec_id = ? AND id != ?
      AND rowid BETWEEN
        (SELECT rowid FROM sections WHERE id = ?) - ?
        AND (SELECT rowid FROM sections WHERE id = ?) + ?
      ORDER BY rowid
    `).all(section.spec_id, section.id, sectionId, neighborWindow, sectionId, neighborWindow);

    result.neighbors = neighbors.map(n => ({
      section_id: n.id,
      section_number: n.section_number,
      section_title: n.section_title,
    }));
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
