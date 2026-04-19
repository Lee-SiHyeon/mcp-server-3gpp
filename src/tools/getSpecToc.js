import { getConnection } from '../db/connection.js';
import {
  countContentfulDescendants,
  getAllSpecIds,
  getContentfulDescendants,
  getSectionByNumber,
  getSectionChildren,
  getSpecById,
} from '../db/queries.js';
import { formatSuccess, formatError } from './helpers.js';

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
    reason: 'This TOC prefix is a structural heading with no direct body content. Use the child or descendant sections below for substantive material.',
    child_sections: childSections,
    suggested_sections: suggestedSections,
    descendant_content_count: contentfulDescendantCount,
  };
}

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

  let sql = `
    SELECT
      t.section_number,
      t.section_title,
      t.page,
      t.depth,
      COALESCE(s.content_length, 0) AS content_length,
      CASE WHEN COALESCE(s.content_length, 0) > 0 THEN 1 ELSE 0 END AS has_content
      ${includeBriefs ? ', t.brief' : ''}
    FROM toc t
    LEFT JOIN sections s
      ON s.spec_id = t.spec_id
     AND s.section_number = t.section_number
    WHERE t.spec_id = ?
  `;
  const params = [specId];

  if (maxDepth !== undefined) {
    sql += ' AND t.depth < ?';
    params.push(maxDepth);
  }

  if (sectionPrefix) {
    sql += ' AND (t.section_number = ? OR t.section_number LIKE ?)';
    params.push(sectionPrefix, `${sectionPrefix}.%`);
  }

  sql += ' ORDER BY t.sort_order, t.section_number';

  const entries = db.prepare(sql).all(...params).map(entry => ({
    ...entry,
    has_content: Boolean(entry.has_content),
    ...(entry.has_content ? {} : { navigation_only: true }),
  }));

  // If no TOC entries, try sections table as fallback
  if (entries.length === 0) {
    let fallbackSql = `
      SELECT
        section_number,
        section_title,
        page_start AS page,
        depth,
        content_length,
        CASE WHEN content_length > 0 THEN 1 ELSE 0 END AS has_content
      FROM sections
      WHERE spec_id = ?
    `;
    const fbParams = [specId];
    if (sectionPrefix) {
      fallbackSql += ' AND (section_number = ? OR section_number LIKE ?)';
      fbParams.push(sectionPrefix, `${sectionPrefix}.%`);
    }
    fallbackSql += ' ORDER BY section_number LIMIT 100';
    const fbEntries = db.prepare(fallbackSql).all(...fbParams).map(entry => ({
      ...entry,
      has_content: Boolean(entry.has_content),
      ...(entry.has_content ? {} : { navigation_only: true }),
    }));

    const result = { spec_id: specId, title: spec.title, entries: fbEntries, source: 'sections_fallback' };
    if (sectionPrefix) {
      const focusSection = getSectionByNumber(specId, sectionPrefix);
      if (focusSection) {
        const hasDirectContent = typeof focusSection.content === 'string' && focusSection.content.trim().length > 0;
        result.focus_section = {
          section_id: focusSection.id,
          section_number: focusSection.section_number,
          section_title: focusSection.section_title,
          page_start: focusSection.page_start,
          page_end: focusSection.page_end,
          content_length: focusSection.content_length,
          has_content: hasDirectContent,
          ...(hasDirectContent ? {} : { navigation_only: true }),
        };
        if (!hasDirectContent) {
          result.navigation = buildNavigation(focusSection);
        }
      }
    }

    return formatSuccess(result);
  }

  const result = { spec_id: specId, title: spec.title, entries };
  if (sectionPrefix) {
    const focusSection = getSectionByNumber(specId, sectionPrefix);
    if (focusSection) {
      const hasDirectContent = typeof focusSection.content === 'string' && focusSection.content.trim().length > 0;
      result.focus_section = {
        section_id: focusSection.id,
        section_number: focusSection.section_number,
        section_title: focusSection.section_title,
        page_start: focusSection.page_start,
        page_end: focusSection.page_end,
        content_length: focusSection.content_length,
        has_content: hasDirectContent,
        ...(hasDirectContent ? {} : { navigation_only: true }),
      };
      if (!hasDirectContent) {
        result.navigation = buildNavigation(focusSection);
      }
    }
  }

  return formatSuccess(result);
}
