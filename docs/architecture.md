# mcp-server-3gpp Architecture

## Operating model

The current server is a DB-backed MCP service for chapter navigation and exact section retrieval across 3GPP and RFC documents.

The design assumption is:

1. The model uses discovery tools to narrow the search space.
2. The model inspects the chapter tree.
3. The model reads exact sections.
4. The model expands outward through nearby chapters and cross-spec citations.

This is intentionally different from a fixed "telecom lookup" server with protocol-specific helper tools. The server exposes a small generic surface and lets the model navigate the corpus.

## Runtime layout

```text
MCP client
  -> stdio transport (src/index.js) or Streamable HTTP (src/http.js)
  -> shared createServer()
  -> tool registry + Zod validation
  -> tool handlers
  -> search/db helpers
  -> SQLite corpus
  -> MCP guide resources (3gpp://guides/*)
```

Both transports share the same server factory:

- `src/index.js` is the normal stdio entrypoint.
- `src/http.js` wraps `createServer()` with HTTP session management, API-key auth, rate limiting, CORS, and `/health`.

## Startup sequence

On startup, `src/index.js` does the following:

1. Resolve the DB path from `THREEGPP_DB_PATH`, `data/corpus/3gpp.db`, then `data/3gpp.db`.
2. Run `initDatabase()` to ensure the v2 schema exists and to probe for `sqlite-vec`.
3. Open the singleton connection via `getConnection()`.
4. Register the current 8 DB-backed tools.
5. Expose three MCP resources for ingest guides.

If no SQLite database exists, `src/index.js` still contains a legacy fallback that registers a reduced `chunks.json` surface. That path is not the documented v2 operating model and should not drive product docs or validation.

## Tool groups

### Discovery

- `get_spec_catalog`
- `search_3gpp_docs`

These tools help the model decide where to look next. `search_3gpp_docs` returns candidate section IDs, snippets, and pagination metadata, not authoritative final answers.

### Structural navigation

- `get_spec_toc`
- `search_related_sections`

`get_spec_toc` is the main chapter browser. `search_related_sections` lets the model move around a known anchor by combining:

- parent lookup
- child lookup
- sibling lookup
- a keyword-derived expansion pass

### Deterministic retrieval

- `get_section`

This is the authoritative text retrieval path. The model should use it once it has identified a relevant chapter.

### Cross-document navigation

- `get_spec_references`

This aggregates outgoing and incoming links from `spec_references`, allowing the model to move between 3GPP specs and RFCs.

### Operational and compatibility tools

- `get_ingest_guide`
- `list_specs`

`get_ingest_guide` is for corpus maintenance. `list_specs` remains for compatibility, but new clients should prefer `get_spec_catalog`.

## Recommended AI navigation loop

```text
Need answer
  -> get_spec_catalog or search_3gpp_docs
  -> get_spec_toc on the most relevant spec
  -> get_section on likely chapters
  -> search_related_sections for local expansion
  -> get_spec_references when the answer crosses documents
```

This loop matters because search alone is noisy on long standards documents. TOC-driven narrowing usually produces better chapter selection and cleaner follow-up retrieval.

## Search pipeline

`search_3gpp_docs` calls `hybridSearch()` in `src/search/hybridRanker.js`.

The current query parser supports:

- quoted phrases
- `spec:...` filters
- `section:...` hints
- negation with `-term` or `NOT term`

### What is active today

- FTS5 BM25 keyword search is the default live path.
- `sections_fts` indexes `section_title` and `content`.
- Search results return ranked section metadata plus snippets and optional scores.

### What is conditional

- `sqlite-vec` can be loaded at runtime.
- `vec_sections` can exist and contain embeddings.
- Semantic or hybrid ranking only becomes active when the search layer is given a query embedding function.

That means the database can advertise vector support while the default MCP tool flow still executes keyword ranking. Docs should reflect that distinction.

## Data responsibilities

### `specs`

Document-level metadata, counts, and titles.

### `toc`

Chapter hierarchy optimized for browsing. `get_spec_toc` reads this first and can fall back to `sections` if TOC rows are missing.

### `sections`

Full section text and hierarchy pointers. `parent_section` enables local graph traversal.

### `sections_fts`

Content-synced FTS5 index for keyword search.

### `spec_references`

Cross-spec citation graph used by `get_spec_references`.

### `ingestion_runs`

Audit log for corpus build/load operations.

### `vec_sections`

Optional runtime table for embeddings.

## Response shaping and validation

- All tool handlers return MCP text content containing JSON.
- `src/tools/validateArgs.js` applies Zod validation before dispatch.
- Validation errors are returned as structured MCP errors, not thrown through the transport.

This keeps the tool layer predictable for LLM callers and easier to smoke-test with `validate.js`.

## Current corpus snapshot

The bundled database currently contains:

- 207 specs
- 66,109 section rows
- 63,376 TOC rows
- 45,162 cross-spec references
- 535 recorded ingestion runs

These numbers come from the shipped `data/corpus/3gpp.db`, not from stale design assumptions.
