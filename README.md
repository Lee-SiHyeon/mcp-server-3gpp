# mcp-server-3gpp

MCP server for 3GPP and IETF RFC specifications, backed by a prebuilt SQLite corpus.

The current v2 server is built around AI-guided chapter navigation, not hard-coded protocol lookup logic. The intended workflow is:

1. Discover relevant specs with `get_spec_catalog` or `search_3gpp_docs`.
2. Walk the chapter structure with `get_spec_toc`.
3. Retrieve exact text with `get_section`.
4. Expand locally with `search_related_sections`.
5. Jump across documents with `get_spec_references`.

Search is a starting point, not the whole product. The model is expected to browse and choose chapters deliberately.

## What ships today

- DB-backed v2 server with 8 MCP tools
- Prebuilt corpus in `data/corpus/3gpp.db`
- 207 specs total: 112 TS, 2 TR, 93 RFC
- 66,109 full sections and 63,376 TOC rows
- 45,162 cross-spec reference edges
- Stdio MCP entrypoint in `src/index.js`
- Optional Streamable HTTP transport in `src/http.js`

## Search behavior

- `search_3gpp_docs` exposes keyword search with quoted phrases, `spec:` filters, `section:` hints, and negation.
- The database and runtime can host `sqlite-vec` embeddings via `vec_sections`.
- The default MCP tool path is still keyword-first unless a query embedding function is supplied to the search layer, so do not assume semantic ranking is active just because `vec_sections` exists.

## Quick start

```bash
git lfs install
git clone https://github.com/Lee-SiHyeon/mcp-server-3gpp.git
cd mcp-server-3gpp
npm install
npm run validate
npm start
```

The bundled database is tracked with Git LFS. A healthy startup looks like:

```text
[3GPP MCP] Database ready: .../data/corpus/3gpp.db
[3GPP MCP] Features - FTS: true, Vector: true
[3GPP MCP] Registered 8 tools (v2 DB mode)
```

## MCP client configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "3gpp": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### VS Code / GitHub Copilot

```json
{
  "servers": {
    "3gpp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-3gpp/src/index.js"]
    }
  }
}
```

### Optional custom DB path

```json
{
  "env": {
    "THREEGPP_DB_PATH": "/custom/path/to/3gpp.db"
  }
}
```

The server checks these DB locations in order:

1. `THREEGPP_DB_PATH`
2. `data/corpus/3gpp.db`
3. `data/3gpp.db`

## Tool surface

| Tool | Purpose |
| --- | --- |
| `get_spec_catalog` | List indexed specs with title, version, series, description, section count, and page count. |
| `get_spec_toc` | Return the chapter hierarchy for a spec, optionally limited by depth or section prefix. |
| `get_section` | Fetch the exact section text by `sectionId` or `specId + sectionNumber`. |
| `search_3gpp_docs` | Rank candidate sections for a query and return section IDs for follow-up retrieval. |
| `search_related_sections` | Expand from an anchor section through parent, child, sibling, and search-derived neighbors. |
| `get_spec_references` | Traverse incoming and outgoing cross-spec citations. |
| `get_ingest_guide` | Return operational instructions for ETSI download, RFC ingest, or the extraction pipeline. |
| `list_specs` | Compatibility alias with a smaller output shape; prefer `get_spec_catalog`. |

## Recommended prompting pattern

Use prompts that encourage structure-first navigation:

```text
Find the chapter in TS 24.301 that defines attach reject causes.
Start by locating the spec, then inspect the TOC, then fetch the most relevant section.
```

```text
I need the exact wording for the NAS registration timer behavior in 5G.
Search for likely sections, then read the chapter text and nearby sections.
```

```text
Show which RFCs and 3GPP specs TS 29.500 cites most often.
```

## Corpus statistics

| Metric | Value |
| --- | --- |
| Total specs | 207 |
| TS specs | 112 |
| TR specs | 2 |
| RFC specs | 93 |
| TOC rows | 63,376 |
| Section rows | 66,109 |
| Cross-spec references | 45,162 |
| Ingestion runs recorded | 535 |

## Architecture at a glance

```text
LLM client
  -> MCP transport (stdio or HTTP)
  -> tool registry + validation
  -> tool handlers
  -> SQLite corpus (specs, toc, sections, sections_fts, spec_references, ingestion_runs)
  -> optional vec_sections table and guide resources
```

More detail lives in [docs/architecture.md](docs/architecture.md) and [docs/data-model.md](docs/data-model.md).

## Validation and tests

```bash
npm run validate
npm test
```

`npm run validate` checks the package metadata, resolves the DB path, verifies the core schema and counts, and confirms that the v2 server registers the current 8-tool surface.

## Project structure

```text
mcp-server-3gpp/
├── src/
│   ├── index.js
│   ├── http.js
│   ├── db/
│   ├── search/
│   ├── tools/
│   └── ingest/
├── docs/
├── db/
├── data/
│   └── corpus/
│       └── 3gpp.db
├── test/
├── validate.js
└── package.json
```

## Notes

- The documented operating model is the DB-backed v2 server.
- There is still a legacy fallback path in `src/index.js` if no SQLite DB is found, but that is a bootstrap escape hatch, not the primary interface this repository documents.
- `get_section` and `get_spec_toc` are the core deterministic retrieval tools. Search should feed them, not replace them.
