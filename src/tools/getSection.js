import { getConnection } from '../db/connection.js';
import { getSectionById, getSectionSuggestions } from '../db/queries.js';
import { formatSuccess, formatError, resolveSectionId } from './helpers.js';

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
  try {
    const db = getConnection();
    let { sectionId, includeNeighbors = false, neighborWindow = 1, maxChars } = args;

    sectionId = resolveSectionId(args);

    if (!sectionId) {
      return formatError('Provide sectionId or both specId and sectionNumber');
    }

    const section = getSectionById(sectionId);

    if (!section) {
      const specPart = sectionId.split(':')[0];
      const numPart = sectionId.split(':')[1] || '';
      const suggestions = getSectionSuggestions(specPart, numPart);

      return formatError({
        error: `Section not found: ${sectionId}`,
        suggestions: suggestions.map(s => ({ id: s.id, title: s.section_title })),
      });
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
      // Use section_number ordering instead of rowid (rowid is not guaranteed contiguous)
      const neighbors = db.prepare(`
        SELECT id, section_number, section_title FROM sections
        WHERE spec_id = ? AND id != ?
        ORDER BY CASE
          WHEN section_number = ? THEN 0
          WHEN section_number > ? THEN 1
          ELSE -1
        END, section_number
        LIMIT ?
      `).all(section.spec_id, section.id, section.section_number, section.section_number, neighborWindow * 2 + 1);

      result.neighbors = neighbors.map(n => ({
        section_id: n.id,
        section_number: n.section_number,
        section_title: n.section_title,
      }));
    }

    return formatSuccess(result);
  } catch (error) {
    console.error(`[get_section] Error:`, error.message, { args });
    return formatError({
      error: error.message,
      tool: 'get_section',
      context: { args },
    });
  }
}
