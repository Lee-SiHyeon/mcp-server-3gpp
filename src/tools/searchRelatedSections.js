import { getConnection } from '../db/connection.js';
import { hybridSearch } from '../search/hybridRanker.js';
import { getSectionById } from '../db/queries.js';
import { formatSuccess, formatError, resolveSectionId } from './helpers.js';

export const searchRelatedSectionsSchema = {
  name: 'search_related_sections',
  description: 'Find sections related to a known anchor section. Discovers parent, child, sibling sections and keyword-related content within the current corpus. Use after get_section to explore nearby procedures or requirements. In v1 this tool stays structural/keyword-oriented rather than live-semantic.',
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

function buildRelatedResult(row, relation, score) {
  return {
    ...row,
    section_id: row.section_id ?? row.id,
    title: row.section_title ?? row.title,
    relation,
    score,
  };
}

export async function handleSearchRelatedSections(args) {
  try {
    const db = getConnection();
    let { sectionId, specId, query, sameSpecOnly = true, maxResults = 5 } = args;

    sectionId = resolveSectionId(args);

    const results = [];
    let anchor = null;

    if (sectionId) {
      const section = getSectionById(sectionId);
      if (!section) {
        return formatError(`Section not found: ${sectionId}`);
      }

      anchor = { section_id: section.id, spec_id: section.spec_id, section_number: section.section_number };
      specId = section.spec_id;

      // Parent section
      if (section.parent_section) {
        const parent = db.prepare(
          'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE id = ?'
        ).get(section.parent_section);
        if (parent) {
          results.push(buildRelatedResult(parent, 'parent', 0.95));
        }
      }

      // Child sections
      const children = db.prepare(
        'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE parent_section = ? ORDER BY section_number LIMIT 5'
      ).all(sectionId);
      for (const child of children) {
        results.push(buildRelatedResult(child, 'child', 0.90));
      }

      // Siblings (same parent)
      if (section.parent_section) {
        const siblings = db.prepare(
          'SELECT id, spec_id, section_number, section_title, page_start, page_end FROM sections WHERE parent_section = ? AND id != ? ORDER BY section_number LIMIT 5'
        ).all(section.parent_section, sectionId);
        for (const sibling of siblings) {
          results.push(buildRelatedResult(sibling, 'sibling', 0.85));
        }
      }

      // Keyword search for related content
      if (results.length < maxResults) {
        const searchQuery = section.section_title;
        const searchSpec = sameSpecOnly ? specId : undefined;
        const searchResults = await hybridSearch(searchQuery, {
          spec: searchSpec,
          maxResults: maxResults * 2,
          mode: 'keyword',
          includeScores: true,
        });
        const existingSectionIds = new Set(results.map((result) => result.section_id));
        for (const searchResult of searchResults.results) {
          if (searchResult.section_id !== sectionId && !existingSectionIds.has(searchResult.section_id)) {
            results.push(buildRelatedResult(searchResult, 'keyword_related', searchResult.score || 0.5));
            existingSectionIds.add(searchResult.section_id);
          }
        }
      }
    } else if (query) {
      anchor = { query };
      const searchResults = await hybridSearch(query, {
        maxResults: maxResults * 2,
        mode: 'keyword',
        includeScores: true,
      });
      for (const searchResult of searchResults.results) {
        results.push(buildRelatedResult(searchResult, 'query_match', searchResult.score || 0.5));
      }
    } else {
      return formatError('Provide sectionId, specId+sectionNumber, or query');
    }

    const trimmed = results.slice(0, maxResults).map((result) => ({
      section_id: result.section_id,
      spec_id: result.spec_id,
      section_number: result.section_number,
      title: result.title,
      relation: result.relation,
      page_start: result.page_start,
      page_end: result.page_end,
      score: Math.round((result.score || 0) * 1000) / 1000,
    }));

    return formatSuccess({ anchor, results: trimmed });
  } catch (error) {
    console.error(`[search_related_sections] Error:`, error.message, { args });
    return formatError({
      error: error.message,
      tool: 'search_related_sections',
      context: { args },
    });
  }
}
