import { getConnection } from '../db/connection.js';
import {
  countContentfulDescendants,
  getContentfulDescendants,
  getSectionById,
  getSectionChildren,
  getSectionSuggestions,
} from '../db/queries.js';
import { formatSuccess, formatError, resolveSectionId } from './helpers.js';

const NAV_CHILD_LIMIT = 10;
const NAV_DESCENDANT_LIMIT = 8;
const GENERIC_TITLE_PATTERNS = [
  /^general$/i,
  /^overview$/i,
  /^introduction$/i,
  /^scope$/i,
  /^abnormal cases\b/i,
];

function isGenericTitle(title) {
  return GENERIC_TITLE_PATTERNS.some(pattern => pattern.test(title || ''));
}

function summarizeBrief(brief, maxChars = 220) {
  if (!brief || typeof brief !== 'string') return undefined;
  const normalized = brief
    .replace(/\bETSI TS \d{3} \d{3} V[\d.]+ \(\d{4}-\d{2}\)\b/ig, ' ')
    .replace(/\b3GPP TS \d{2}\.\d{3} version [\d.]+ Release \d+\b/ig, ' ')
    .replace(/\bETSI\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxChars
    ? `${normalized.substring(0, maxChars - 3)}...`
    : normalized;
}

function toNavigationEntry(section) {
  return {
    section_id: section.id,
    section_number: section.section_number,
    section_title: section.section_title,
    page_start: section.page_start,
    page_end: section.page_end,
    content_length: section.content_length,
    has_content: section.content_length > 0,
    ...(section.brief ? { brief: summarizeBrief(section.brief) } : {}),
  };
}

function buildNavigation(section) {
  const childSections = getSectionChildren(section.id, NAV_CHILD_LIMIT).map(toNavigationEntry);
  const suggestedSections = getContentfulDescendants(
    section.spec_id,
    section.section_number,
    NAV_DESCENDANT_LIMIT,
  )
    .sort((a, b) =>
      Number(isGenericTitle(a.section_title)) - Number(isGenericTitle(b.section_title)) ||
      a.depth - b.depth ||
      a.page_start - b.page_start ||
      a.section_number.localeCompare(b.section_number, undefined, { numeric: true })
    )
    .map(toNavigationEntry);
  const contentfulDescendantCount = countContentfulDescendants(section.spec_id, section.section_number);

  return {
    navigation_only: true,
    reason: 'This section is a structural heading with no direct body content. Use the child or descendant sections below for procedure details.',
    child_sections: childSections,
    suggested_sections: suggestedSections,
    descendant_content_count: contentfulDescendantCount,
  };
}

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

    const hasDirectContent = typeof section.content === 'string' && section.content.trim().length > 0;
    let content = section.content || '';
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
        has_content: hasDirectContent,
        ...(hasDirectContent ? {} : { navigation_only: true }),
        ...(truncated ? { truncated: true } : {}),
      },
    };

    if (!hasDirectContent) {
      result.navigation = buildNavigation(section);
    }

    if (includeNeighbors) {
      const neighbors = db.prepare(`
        WITH ordered AS (
          SELECT
            s.id,
            s.section_number,
            s.section_title,
            ROW_NUMBER() OVER (
              ORDER BY
                COALESCE(t.sort_order, 1000000000),
                COALESCE(s.page_start, 1000000000),
                s.rowid
            ) AS ord
          FROM sections s
          LEFT JOIN toc t
            ON t.spec_id = s.spec_id
           AND t.section_number = s.section_number
          WHERE s.spec_id = ?
        ),
        anchor AS (
          SELECT ord FROM ordered WHERE id = ?
        )
        SELECT ordered.id, ordered.section_number, ordered.section_title
        FROM ordered
        JOIN anchor
        WHERE ordered.id != ?
          AND ABS(ordered.ord - anchor.ord) <= ?
        ORDER BY ordered.ord
      `).all(section.spec_id, section.id, section.id, neighborWindow);

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
