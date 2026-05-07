# Citation Insertion Implementation Plan

## Executive Summary

Add Citation Insertion as a small, testable citation layer on top of the existing SQLite-backed 3GPP search server. The implementation will introduce a pure citation formatting module, a DB metadata lookup path that joins sections to spec metadata, a new `generate_citation` MCP tool, and optional citation enrichment in search results. No schema migration is required for the first slice because `specs.version` already exists and version is stored per spec, not per section. Source tracking will be returned as structured data to the MCP caller rather than persisted server-side.

## Current Codebase Findings

| File | Current Role |
|---|---|
| `src/index.js` | Registers all DB-backed MCP tools through `registerAllTools()` and dispatches tool calls through `validateArgs()` |
| `src/tools/registry.js` | Stores tool schemas and handlers |
| `src/tools/search3gppDocs.js` | MCP handler for `search_3gpp_docs`, calls `hybridSearch()` |
| `src/search/hybridRanker.js` | Builds search result objects from ranked rows |
| `src/db/queries.js` | Shared DB lookup helpers, currently has `getSectionById()` and `getSpecById()` |
| `db/schema.sql` | `specs.version` exists; `sections` does not store version |
| `src/tools/validateArgs.js` | Zod validation for registered tools |

Version storage: `specs.version` (e.g. `v18.9.0`) — join through `spec_id` on sections. Fallback: `etsi_documents.latest_version`.

## Architecture Decisions

### Citation Metadata Model

```js
{
  section_id: 'ts_38_331:5.3.2',
  spec_id: 'ts_38_331',
  doc_type: 'TS',
  doc_number: '38.331',
  spec_title: 'NR; Radio Resource Control (RRC) protocol specification',
  spec_version: 'v18.3.0',
  section_number: '5.3.2',
  section_title: 'RRC connection establishment',
  page_start: 42,
  page_end: 44,
  source_id: 'ts_38_331:5.3.2'
}
```

### Citation Styles

| Style | Example |
|---|---|
| `3gpp` | `3GPP TS 38.331 v18.3.0, Section 5.3.2, "RRC connection establishment"` |
| `ieee` | `[1] 3GPP, "RRC connection establishment," 3GPP TS 38.331, sec. 5.3.2, version 18.3.0.` |
| `apa` | `3rd Generation Partnership Project. (n.d.). RRC connection establishment (3GPP TS 38.331, Section 5.3.2, Version 18.3.0).` |
| `plain` | `3GPP TS 38.331 v18.3.0 - Section 5.3.2 - RRC connection establishment` |

### DB Lookup

Add to `src/db/queries.js`:

```js
export function getCitationSourcesBySectionIds(sectionIds) {
  const db = getConnection();
  const placeholders = sectionIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT
      s.id AS section_id,
      s.spec_id,
      s.section_number,
      s.section_title,
      s.page_start,
      s.page_end,
      sp.title AS spec_title,
      sp.version AS spec_version,
      sp.source_pdf,
      d.latest_version AS catalog_latest_version
    FROM sections s
    JOIN specs sp ON sp.id = s.spec_id
    LEFT JOIN etsi_documents d ON d.mapped_3gpp_id = sp.id
    WHERE s.id IN (${placeholders})
  `).all(...sectionIds);
}
```

Version priority: `specs.version` > `etsi_documents.latest_version` > omit.

### MCP Tool: `generate_citation`

Input:
```js
{
  section_ids: string[],  // required, min 1
  style: '3gpp' | 'ieee' | 'apa' | 'plain'  // optional, default '3gpp'
}
```

Output:
```js
{
  citations: [{ section_id, citation, style, source_id }],
  sources: [{ source_id, section_id, spec_id, section_number, section_title }],
  missing_section_ids: string[]
}
```

### Search Auto-Citation

Add optional params to `search_3gpp_docs`:
- `includeCitations: boolean` (default `false`)
- `citationStyle: '3gpp' | 'ieee' | 'apa' | 'plain'` (default `'3gpp'`)

Enrich results at the handler level (not inside `hybridSearch`) to avoid cache complications in first slice.

## Implementation Steps

### Step 1: Formatter Tests + Implementation

Create `test/citationFormatters.test.js` first (TDD).

Create:
- `src/citations/formatters.js` — `formatCitation(source, style, index)`
- `src/citations/specId.js` — `parseSpecId('ts_38_331')` → `{ doc_type: 'TS', doc_number: '38.331' }`

### Step 2: Metadata Lookup Tests + DB Queries

Create `test/citationMetadata.test.js` with temp SQLite DB.

Add `getCitationSourcesBySectionIds()` to `src/db/queries.js`.

### Step 3: `generate_citation` Tool

Create `src/tools/generateCitation.js`.

Register in `src/index.js`. Add Zod schema to `src/tools/validateArgs.js`:
```js
generate_citation: z.object({
  section_ids: z.array(z.string().min(1)).min(1),
  style: z.enum(['3gpp', 'ieee', 'apa', 'plain']).optional(),
}),
```

Add `formatStructuredSuccess(data)` in `src/tools/helpers.js`.

### Step 4: Search Enrichment

Update `src/tools/search3gppDocs.js` to accept `includeCitations` + `citationStyle`.

Enrich after `hybridSearch()` returns — join citation sources for result `section_id`s.

### Step 5: Registry Passthrough

Update `src/tools/registry.js` to pass `outputSchema` and `annotations` from tool schemas.

## Test Strategy

Run full suite: `node --test`

Targeted TDD commands:
```sh
node --test --test-concurrency=1 test/citationFormatters.test.js
node --test --test-concurrency=1 test/citationMetadata.test.js
node --test --test-concurrency=1 test/generateCitationTool.test.js
node --test --test-concurrency=1 test/searchCitations.test.js
```

Manual smoke test:
```json
{ "tool": "generate_citation", "arguments": { "section_ids": ["ts_38_331:5.3.2"], "style": "3gpp" } }
```

## Atomic Commit Strategy

1. `test: citation formatter behavior` + `src/citations/formatters.js`
2. `feat: add citation metadata DB lookup`
3. `feat: add generate_citation MCP tool`
4. `feat: include citations in search results`

Each commit must pass full `node --test`.

## Effort Estimate

4 to 6 hours (1 working day risk-adjusted for cache and version-gap edge cases).
