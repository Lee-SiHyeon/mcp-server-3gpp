import { getCitationSourcesBySectionIds as getRows } from '../db/queries.js';
import { parseSpecId } from './specId.js';

export function normalizeCitationSource(row) {
  const parsed = parseSpecId(row.spec_id);
  return {
    section_id: row.section_id,
    spec_id: row.spec_id,
    doc_type: parsed.doc_type,
    doc_number: parsed.doc_number,
    spec_title: row.spec_title,
    spec_version: row.spec_version || row.catalog_latest_version || undefined,
    section_number: row.section_number,
    section_title: row.section_title,
    page_start: row.page_start,
    page_end: row.page_end,
    source_id: row.section_id,
  };
}

export function getCitationSourcesBySectionIds(sectionIds) {
  if (!Array.isArray(sectionIds) || sectionIds.length === 0) return [];
  return getRows(sectionIds).map(normalizeCitationSource);
}
