/**
 * Zod-based input validation for every registered MCP tool.
 *
 * Schemas mirror each tool's inputSchema but enforce stricter types and ranges.
 * The validateArgs() function returns either the parsed data or a structured
 * validation error that the dispatcher can return directly.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-tool schemas
// ---------------------------------------------------------------------------

const schemas = {
  search_3gpp_docs: z.object({
    query: z.string().min(1, 'Query is required'),
    spec: z.string().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
    mode: z.enum(['auto', 'keyword', 'semantic', 'hybrid']).optional(),
    includeScores: z.boolean().optional(),
  }),

  get_section: z.object({
    sectionId: z.string().optional(),
    specId: z.string().optional(),
    sectionNumber: z.string().optional(),
    includeNeighbors: z.boolean().optional(),
    neighborWindow: z.number().int().min(0).max(10).optional(),
    maxChars: z.number().int().min(1).optional(),
  }),

  get_spec_toc: z.object({
    specId: z.string().min(1, 'specId is required'),
    maxDepth: z.number().int().min(1).max(20).optional(),
    sectionPrefix: z.string().optional(),
    includeBriefs: z.boolean().optional(),
  }),

  get_spec_catalog: z.object({
    filter: z.string().optional(),
    family: z.string().optional(),
  }),

  get_spec_references: z.object({
    specId: z.string().min(1, 'specId is required'),
    direction: z.enum(['outgoing', 'incoming', 'both']).optional(),
    inCorpusOnly: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  }),

  search_etsi_catalog: z.object({
    query: z.string().optional(),
    publicationType: z.string().optional(),
    mapped3gppSpec: z.string().optional(),
    range: z.string().optional(),
    onlyIngested: z.boolean().optional(),
    hasVersions: z.boolean().optional(),
    hasFiles: z.boolean().optional(),
    selectedForIngest: z.boolean().optional(),
    ingestStatus: z.string().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  }),

  get_etsi_document: z.object({
    documentId: z.string().optional(),
    publicationType: z.string().optional(),
    etsiNumber: z.string().optional(),
    mapped3gppSpec: z.string().optional(),
    includeFiles: z.boolean().optional(),
    maxVersions: z.number().int().min(1).max(200).optional(),
  }),

  search_related_sections: z.object({
    sectionId: z.string().optional(),
    specId: z.string().optional(),
    sectionNumber: z.string().optional(),
    query: z.string().optional(),
    sameSpecOnly: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
  }),

  get_ingest_guide: z.object({
    type: z.enum(['catalog', 'etsi', 'rfc', 'autorag', 'all']),
  }),

  list_specs: z.object({}).passthrough(),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate tool arguments against the matching Zod schema.
 *
 * @param {string} toolName — registered tool name
 * @param {object} args     — raw arguments from the MCP request
 * @returns {{ valid: true, args: object } | { valid: false, error: object }}
 */
export function validateArgs(toolName, args) {
  const schema = schemas[toolName];
  if (!schema) return { valid: true, args }; // unknown tools pass through

  const result = schema.safeParse(args);
  if (result.success) {
    return { valid: true, args: result.data };
  }

  return {
    valid: false,
    error: {
      error: 'validation_error',
      details: result.error.issues.map(issue => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    },
  };
}
