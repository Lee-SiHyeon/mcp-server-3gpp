import { getConnection } from '../db/connection.js';
import { hybridSearch } from '../search/hybridRanker.js';

export const searchRelatedSectionsSchema = {
  name: 'search_related_sections',
  description: 'Find sections related to a known anchor section. Discovers parent, child, sibling sections and semantically similar content. Use after get_section to explore related procedures or requirements.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: 'Anchor section ID' },
      specId: { type: 'string', description: 'Spec ID (with sectionNumber)' },
      sectionNumber: { type: 'string', description: 'Section number (with specId)' },
      query: { type: 'string', description: 'Fallback free-text query if no section anchor' },
      sameSpecOnly: { type: 'boolean', description: 'Stay within same spec (default: true)' },
      maxResults: { type: 'number', description: 'Max results (default: 5)' },
    },
  },
};

export function handleSearchRelatedSections(args) {
  const db = getConnection();
  let { sectionId, specId, sectionNumber, query, sameSpecOnly = true, maxResults = 5 } = args;

  if (!sectionId && specId && sectionNumber) {
    sectionId = `${specId}:${sectionNumber}`;
  }

  const results = [];
  let anchor = null;

  if (sectionId) {
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!section) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Section not found: ${sectionId}` }) }] };
    }

    anchor = { section_id: section.id, spec_id: section.spec_id, section_number: section.section_number };
    specId = section.spec_id;

    // Parent section
    if (section.parent_section) {
      const parent = db.prepare(
        'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE id = ?'
      ).get(section.parent_section);
      if (parent) results.push({ ...parent, section_id: parent.id, relation: 'parent', score: 0.95 });
    }

    // Child sections
    const children = db.prepare(
      'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE parent_section = ? ORDER BY section_number LIMIT 5'
    ).all(sectionId);
    for (const c of children) {
      results.push({ ...c, section_id: c.id, relation: 'child', score: 0.90 });
    }

    // Siblings (same parent)
    if (section.parent_section) {
      const siblings = db.prepare(
        'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE parent_section = ? AND id != ? ORDER BY section_number LIMIT 5'
      ).all(section.parent_section, sectionId);
      for (const s of siblings) {
        results.push({ ...s, section_id: s.id, relation: 'sibling', score: 0.85 });
      }
    }

    // Keyword search for related content
    if (results.length < maxResults) {
      const searchQuery = section.section_title;
      const searchSpec = sameSpecOnly ? specId : undefined;
      const searchResults = hybridSearch(searchQuery, { spec: searchSpec, maxResults: maxResults * 2, includeScores: true });
      for (const sr of searchResults.results) {
        if (sr.section_id !== sectionId && !results.find(r => r.section_id === sr.section_id)) {
          results.push({ ...sr, relation: 'keyword_related', score: sr.score || 0.5 });
        }
      }
    }
  } else if (query) {
    anchor = { query };
    const searchResults = hybridSearch(query, { maxResults: maxResults * 2, includeScores: true });
    for (const sr of searchResults.results) {
      results.push({ ...sr, relation: 'query_match', score: sr.score || 0.5 });
    }
  } else {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Provide sectionId, specId+sectionNumber, or query' }) }] };
  }

  const trimmed = results.slice(0, maxResults).map(r => ({
    section_id: r.section_id || r.id,
    spec_id: r.spec_id,
    section_number: r.section_number,
    title: r.section_title || r.title,
    relation: r.relation,
    page_start: r.page_start,
    page_end: r.page_end,
    score: Math.round((r.score || 0) * 1000) / 1000,
  }));

  return { content: [{ type: 'text', text: JSON.stringify({ anchor, results: trimmed }, null, 2) }] };
}
