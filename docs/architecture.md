# mcp-server-3gpp Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Data Pipeline                                  │
│                                                                         │
│  ETSI Portal                                                            │
│      │                                                                  │
│      ▼                                                                  │
│  download_etsi_specs.py  ──►  raw/*.pdf                                 │
│                                   │                                     │
│                                   ▼                                     │
│              extract_all.py  ──►  extracted/*_sections.jsonl            │
│                                   │                                     │
│                                   ▼                                     │
│              build_corpus.js ──►  data/corpus/3gpp.db (SQLite)         │
│                                   ├─ specs (26 rows)                    │
│                                   ├─ sections (31,777 rows)             │
│                                   └─ sections_fts (FTS5 virtual table)  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │         MCP Server              │
                    │  (src/index.js + 7 tools)       │
                    └───────────────┬────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │         AI Client               │
                    │  (Claude, Copilot, etc.)        │
                    └────────────────────────────────┘
```

## Components

### Data Pipeline

| Script | Purpose |
|--------|---------|
| `scripts/download_etsi_specs.py` | Downloads 3GPP spec PDFs from the ETSI portal (optional `--latest-only` flag) |
| `scripts/extract_all.py` | Extracts structured sections from PDFs using pdfplumber; outputs `*_sections.jsonl` |
| `scripts/build_corpus.js` | Ingests JSONL files into SQLite with FTS5 index; use `--rebuild` to re-index |
| `scripts/migrate_legacy_json_to_sqlite.js` | One-time migration from v1 `chunks.json` to v2 SQLite schema |
| `scripts/benchmark.js` | Measures DB cold-start time and FTS5 query latency |

### Database Schema

```sql
-- Spec-level metadata
CREATE TABLE specs (
  id             TEXT PRIMARY KEY,   -- e.g., "ts_24_301"
  title          TEXT,
  version        TEXT,
  series         TEXT,
  description    TEXT,
  total_sections INTEGER,
  total_pages    INTEGER,
  source_pdf     TEXT
);

-- Full section content
CREATE TABLE sections (
  id             TEXT PRIMARY KEY,   -- e.g., "ts_24_301:5.5.1.2"
  spec_id        TEXT REFERENCES specs(id),
  section_number TEXT,
  section_title  TEXT,
  content        TEXT,
  content_length INTEGER,
  page_start     INTEGER,
  page_end       INTEGER,
  depth          INTEGER,
  parent_id      TEXT,
  brief          TEXT               -- first ~180 chars, pre-computed
);

-- FTS5 full-text index (BM25 ranking)
CREATE VIRTUAL TABLE sections_fts USING fts5(
  section_number, section_title, content,
  content=sections, content_rowid=rowid
);
```

**Stats:** 26 spec records · 31,777 section records

### Search Engine

```
src/search/
├── queryParser.js     — Parses query syntax (phrases, spec: filters, -negations)
├── keywordSearch.js   — FTS5/BM25 search against sections_fts
├── semanticSearch.js  — Vector similarity search (requires sqlite-vec; optional)
└── hybridRanker.js    — Fusion scoring: α·keyword + (1-α)·semantic
                         Default α = 0.4  (favors semantic rescue)
```

**Mode selection (auto):**

```
isVectorSearchAvailable()?
  yes → mode = 'hybrid'   (α·keyword + (1-α)·semantic)
  no  → mode = 'keyword'  (FTS5 only — graceful fallback)
```

### MCP Tools (7)

| Tool | Input Schema (key fields) | Description |
|------|--------------------------|-------------|
| `get_spec_catalog` | `filter?`, `family?` | List all indexed specs with metadata |
| `get_spec_toc` | `specId`, `maxDepth?`, `sectionPrefix?` | Hierarchical table of contents |
| `get_section` | `sectionId` OR `specId`+`sectionNumber` | Full section content + neighbors |
| `search_3gpp_docs` | `query`, `spec?`, `mode?`, `maxResults?`, `page?` | Hybrid search with ranked results |
| `search_related_sections` | `sectionId`, `maxResults?` | Conceptually adjacent sections |
| `get_emm_cause` | `cause`, `type?` | LTE EMM or 5G 5GMM cause code lookup |
| `list_specs` | — | Quick listing of available spec IDs |

### Ingest Utilities (`src/ingest/`)

- **`sectionNormalizer.js`** — Canonical spec ID normalization (`normalizeSpecId`), title cleaning, brief generation
- **`loadDatabase.js`** — Loads extracted JSONL into SQLite (`loadStructuredSections`)
- **`migrateLegacyChunks.js`** — Migrates v1 `chunks.json` format to v2 SQLite schema

## Data Flow

```
1. PDF text extracted by pdfplumber (extract_all.py)
2. Sections detected by heading patterns → *_sections.jsonl
3. normalizeSpecId() maps filenames → canonical IDs (e.g., ts_24_301)
4. sections rows INSERTed into SQLite (id = "ts_24_301:5.5.1.2")
5. FTS5 index built on (section_number, section_title, content)
6. hybridSearch(query) → keywordSearch() → ranked results
7. MCP tool wraps results as { content: [{ type: "text", text: JSON }] }
8. AI client receives structured JSON for further tool calls
```

## Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| `sqlite-vec` not installed | `isVectorSearchAvailable()` → `false`; auto-falls back to keyword-only mode |
| DB file missing | `getConnection()` creates empty DB; `hybridSearch` returns `[]` with `totalHits: 0` |
| Unknown spec filter | FTS5 WHERE clause matches nothing; returns 0 results cleanly |
| Empty query | `keywordSearch` returns `[]` before FTS5 execution; no crash |
| Section not found | `handleGetSection` returns `{ error, suggestions }` instead of throwing |

## Configuration

The DB path is resolved in this order:

1. `THREEGPP_DB_PATH` environment variable
2. Default: `<project-root>/data/corpus/3gpp.db`

```bash
THREEGPP_DB_PATH=/custom/path/3gpp.db node src/index.js
```

## Development

```bash
# Run tests
npm test

# Run benchmark
npm run benchmark

# Build corpus from scratch
npm run corpus:full
```
