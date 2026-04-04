/**
 * JSDoc type definitions for the 3GPP MCP Server data model.
 *
 * These types mirror the SQLite schema in db/schema.sql and are consumed by
 * editors / language servers for autocompletion and type-checking.
 *
 * Import them where needed:
 *   /** @typedef {import('../types/records.js').SpecRecord} SpecRecord *​/
 */

// ---------------------------------------------------------------------------
// Core record types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SpecRecord
 * @property {string} id - Spec identifier, e.g., 'ts_24_301'
 * @property {string} title - Full spec title
 * @property {string} [version] - Version string, e.g., 'v18.9.0'
 * @property {string} [series] - Series number for grouping, e.g., '24'
 * @property {string} [description] - Brief description (160-240 chars)
 * @property {number} total_sections - Count of sections in this spec
 * @property {number} total_pages - Total page count
 * @property {string} [source_pdf] - Original PDF filename
 * @property {string} [ingested_at] - ISO 8601 timestamp of ingestion
 */

/**
 * @typedef {Object} TocEntry
 * @property {number} [id] - Auto-incremented row id
 * @property {string} spec_id - FK to specs.id
 * @property {string} section_number - e.g., '5.3.2.1'
 * @property {string} section_title - Section heading text
 * @property {number} [page] - Page number in PDF
 * @property {number} depth - Nesting depth (0=top-level)
 * @property {string} [brief] - First sentence or ~180 chars summary
 * @property {number} [sort_order] - Document order
 */

/**
 * @typedef {Object} SectionRecord
 * @property {string} id - Composite key 'spec_id:section_number'
 * @property {string} spec_id - FK to specs.id
 * @property {string} section_number - e.g., '5.3.2.1'
 * @property {string} section_title - Section heading
 * @property {number} [page_start] - Starting page
 * @property {number} [page_end] - Ending page
 * @property {string} content - Full section text
 * @property {number} [content_length] - Length of content in chars
 * @property {string} [parent_section] - Parent composite key
 * @property {number} depth - Nesting depth
 */

// ---------------------------------------------------------------------------
// Search / query result types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SearchResult
 * @property {string} section_id - Matched section composite key
 * @property {string} spec_id - Spec the section belongs to
 * @property {string} section_number - Section number
 * @property {string} section_title - Section title
 * @property {number} [score] - Combined relevance score
 * @property {number} [keyword_score] - FTS5 BM25 score
 * @property {number} [semantic_score] - Vector similarity (0-1, if available)
 * @property {string} [snippet] - Text snippet with highlights
 * @property {string} [evidence] - Why this result matched
 */

// ---------------------------------------------------------------------------
// Ingestion tracking
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} IngestionRun
 * @property {number} [id] - Auto-incremented row id
 * @property {string} [spec_id] - Which spec was ingested
 * @property {string} source_type - 'pdf_extraction' or 'legacy_migration'
 * @property {number} [rows_inserted] - Number of rows written
 * @property {string} [warnings] - JSON array of warning strings
 * @property {string} [started_at] - ISO 8601 start timestamp
 * @property {string} [completed_at] - ISO 8601 completion timestamp
 */

// Make this a valid ES module so it can be imported for its typedefs.
export {};
