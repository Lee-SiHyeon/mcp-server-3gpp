# Data Model

## Overview

The current repository ships a structured SQLite corpus at `data/corpus/3gpp.db`.

This is the v2 data model used by the live server:

- `specs` stores document-level metadata.
- `toc` stores chapter navigation rows.
- `sections` stores full section text.
- `sections_fts` powers FTS5 keyword search.
- `spec_references` stores cross-spec citations.
- `ingestion_runs` records corpus load activity.
- `vec_sections` is optional and appears only when `sqlite-vec` is available and embeddings have been loaded.

Current bundled corpus counts:

| Table / concept | Count |
| --- | --- |
| Specs | 207 |
| TOC rows | 63,376 |
| Section rows | 66,109 |
| Cross-spec references | 45,162 |
| Ingestion runs | 535 |

## Entity relationships

```text
specs (1) ----< toc
specs (1) ----< sections
sections (self) ---- parent_section
sections (1) ---- sections_fts (content-synced FTS index by rowid)
specs (many) ----< spec_references >---- (many) specs
sections (0/1) ----< vec_sections
```

## ID conventions

| Concept | Format | Example |
| --- | --- | --- |
| Spec ID | `{prefix}_{series}_{number}` or `rfc_{number}` | `ts_24_301`, `tr_37_901`, `rfc_3261` |
| Section ID | `{spec_id}:{section_number}` | `ts_24_301:5.5.1.2.4` |
| Parent section ID | Same as section ID | `ts_24_301:5.5.1.2` |

Notes:

- The prefix on `specs.id` carries the document family: `ts_`, `tr_`, or `rfc_`.
- `series` is stored separately and is mainly useful for grouping 3GPP documents.
- `parent_section` is stored directly in `sections`; tree traversal does not depend on string slicing alone.

## Core tables

### `specs`

One row per indexed document.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | Canonical spec ID |
| `title` | TEXT NOT NULL | Full document title |
| `version` | TEXT | Version string when available |
| `series` | TEXT | Series grouping such as `24`, `29`, `38` |
| `description` | TEXT | Brief summary |
| `total_sections` | INTEGER | Number of section rows for the document |
| `total_pages` | INTEGER | Page count if known |
| `source_pdf` | TEXT | Origin file name for PDF-based ingest |
| `ingested_at` | TEXT | Default `datetime('now')` |

`get_spec_catalog` reads from this table.

### `toc`

Navigation-oriented chapter index. This is what `get_spec_toc` uses first.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Internal row ID |
| `spec_id` | TEXT NOT NULL | FK to `specs.id` |
| `section_number` | TEXT NOT NULL | Chapter number |
| `section_title` | TEXT NOT NULL | Heading text |
| `page` | INTEGER | Page number if known |
| `depth` | INTEGER | `0` for top level, then increasing depth |
| `brief` | TEXT | Short summary text |
| `sort_order` | INTEGER | Preserves source order |

Constraints and behavior:

- Unique on `(spec_id, section_number)`
- Indexed by `spec_id`
- `get_spec_toc` can fall back to `sections` if no TOC rows exist for a spec

### `sections`

Full text retrieval table and local hierarchy graph.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | Composite section ID |
| `spec_id` | TEXT NOT NULL | FK to `specs.id` |
| `section_number` | TEXT NOT NULL | Chapter number |
| `section_title` | TEXT NOT NULL | Heading text |
| `page_start` | INTEGER | First page |
| `page_end` | INTEGER | Last page |
| `content` | TEXT NOT NULL | Full section text |
| `content_length` | INTEGER | Character count |
| `parent_section` | TEXT | Parent section ID |
| `depth` | INTEGER | Depth within the document tree |

Constraints and indexes:

- Unique on `(spec_id, section_number)`
- Indexed by `spec_id`
- Indexed by `parent_section`
- Covering index on `(spec_id, section_number, section_title, id)`

Tool usage:

- `get_section` reads exact text from this table.
- `search_related_sections` uses `parent_section` to discover parent, child, and sibling nodes.

## Search index

### `sections_fts`

`sections_fts` is an FTS5 virtual table in content-sync mode.

Indexed fields:

- `section_title`
- `content`

Important correction: the live FTS table does not index `section_number`.

Synchronization is handled by these triggers:

- `sections_ai`
- `sections_ad`
- `sections_au`

Keyword ranking uses SQLite `bm25(sections_fts)` and snippet extraction.

## Cross-spec graph

### `spec_references`

Stores document-to-document reference edges, aggregated by `get_spec_references`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Internal row ID |
| `source_spec_id` | TEXT NOT NULL | Spec containing the reference |
| `target_spec_id` | TEXT NOT NULL | Referenced spec |
| `ref_type` | TEXT NOT NULL | Usually `3gpp` or `rfc` |
| `citation_text` | TEXT | Raw matched citation text |
| `section_id` | TEXT | Section where the citation was found |
| `in_corpus` | INTEGER DEFAULT 0 | Whether the target spec exists in `specs` |

Constraints and indexes:

- Unique on `(source_spec_id, target_spec_id, section_id)`
- Indexed by `source_spec_id`
- Indexed by `target_spec_id`

This table is the bridge for cross-document reasoning, especially when a chapter points into RFCs or adjacent 3GPP releases/specs.

## Ingestion audit trail

### `ingestion_runs`

Captures corpus-build metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Internal row ID |
| `spec_id` | TEXT | Document ingested, if scoped |
| `source_type` | TEXT | For example `pdf_extraction` or `legacy_migration` |
| `rows_inserted` | INTEGER | Number of rows written |
| `warnings` | TEXT | JSON-encoded warning list |
| `started_at` | TEXT | Default `datetime('now')` |
| `completed_at` | TEXT | Completion timestamp |

This table is operational metadata. It is not queried by end-user MCP tools.

## Optional vector table

### `vec_sections`

This table is created at runtime by `src/db/schema.js` only if `sqlite-vec` loads successfully.

| Column | Type | Notes |
| --- | --- | --- |
| `section_id` | TEXT PRIMARY KEY | References `sections.id` |
| `embedding` | `float[384]` | Dense vector |

Important runtime nuance:

- The presence of `vec_sections` means the database can store embeddings.
- It does not guarantee that `search_3gpp_docs` will run semantic search in normal MCP usage.
- The current search layer only activates semantic or hybrid ranking when a query embedding function is provided.

## Tool-to-table mapping

| Tool | Primary tables |
| --- | --- |
| `get_spec_catalog` | `specs` |
| `get_spec_toc` | `toc`, fallback `sections` |
| `get_section` | `sections` |
| `search_3gpp_docs` | `sections_fts`, `sections`, optional `vec_sections` |
| `search_related_sections` | `sections`, then `sections_fts` via search helpers |
| `get_spec_references` | `spec_references`, `specs` |
| `get_ingest_guide` | None, static guide payload |
| `list_specs` | `specs` |

## Files that define the model

```text
db/schema.sql
src/db/schema.js
src/db/connection.js
src/db/queries.js
src/types/records.js
```

These files, plus the shipped SQLite database, are the source of truth for the current v2 model. Older `chunks.json` descriptions are legacy history, not the active data contract.
