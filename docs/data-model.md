# Data Model — mcp-server-3gpp v2.0

## Overview

Version 2.0 migrates from a flat JSON corpus (`data/chunks.json`, ~22K chunks loaded entirely into memory) to a structured SQLite database with FTS5 full-text search and optional vector similarity search.

The new model gives us:

- **Structured navigation** — specs → table-of-contents → sections hierarchy.
- **BM25 keyword search** via FTS5, replacing the naïve `string.includes` scan.
- **Optional semantic search** via sqlite-vec 384-dimension embeddings.
- **Incremental ingestion** — load one spec at a time instead of rebuilding the whole file.
- **Auditability** — every ingestion run is recorded with row counts and warnings.

The schema lives in `db/schema.sql` and is applied automatically by `src/db/schema.js` on first use.

---

## Entity-Relationship Diagram

```
┌──────────────┐
│    specs     │
│──────────────│
│ PK id        │──────────────────┐
│    title     │                  │
│    version   │                  │
│    series    │                  │
│    ...       │                  │
└──────────────┘                  │
       │                          │
       │ 1 ─── N                  │ 1 ─── N
       ▼                          ▼
┌──────────────┐          ┌───────────────┐
│     toc      │          │   sections    │───── sections_fts (FTS5)
│──────────────│          │───────────────│
│ PK id (auto) │          │ PK id         │
│ FK spec_id   │          │ FK spec_id    │
│    section_# │          │    section_#  │
│    title     │          │    content    │
│    page      │          │ FK parent_sec │──┐  (self-referential)
│    depth     │          │    depth      │  │
│    brief     │          └───────────────┘  │
│    sort_order│                  ▲           │
└──────────────┘                  └───────────┘
                                       │
                                       │ (optional, runtime)
                                       ▼
                               ┌───────────────┐
                               │ vec_sections   │
                               │───────────────│
                               │ PK section_id  │
                               │    embedding   │
                               │   float[384]   │
                               └───────────────┘
```

---

## Tables

### `specs` — Specification Registry

Each 3GPP specification document (e.g., TS 24.301) gets one row.

| Column          | Type    | Description                                  |
|-----------------|---------|----------------------------------------------|
| `id`            | TEXT PK | Lowercase underscore format: `ts_24_301`     |
| `title`         | TEXT    | Full spec title                              |
| `version`       | TEXT    | Version string, e.g., `v18.9.0`             |
| `series`        | TEXT    | Series number for grouping, e.g., `24`       |
| `description`   | TEXT    | Brief description (160-240 chars)            |
| `total_sections`| INTEGER | Count of sections ingested                   |
| `total_pages`   | INTEGER | Total page count from PDF                    |
| `source_pdf`    | TEXT    | Original PDF filename                        |
| `ingested_at`   | TEXT    | ISO 8601 timestamp (auto-set)                |

### `toc` — Table of Contents

Lightweight navigation index. One row per section heading — no full text.

| Column           | Type    | Description                                |
|------------------|---------|--------------------------------------------|
| `id`             | INTEGER | Auto-incremented PK                        |
| `spec_id`        | TEXT FK | References `specs.id`                      |
| `section_number` | TEXT    | e.g., `5.3.2.1`                            |
| `section_title`  | TEXT    | Heading text                               |
| `page`           | INTEGER | Page number in the PDF                     |
| `depth`          | INTEGER | Nesting depth: 0 = top-level               |
| `brief`          | TEXT    | First sentence or ~180 chars summary       |
| `sort_order`     | INTEGER | Preserves original document order          |

Unique constraint on `(spec_id, section_number)`.

### `sections` — Full Section Content

The primary search corpus. Each row holds the complete text of one section.

| Column           | Type    | Description                                |
|------------------|---------|--------------------------------------------|
| `id`             | TEXT PK | Composite key: `{spec_id}:{section_number}`|
| `spec_id`        | TEXT FK | References `specs.id`                      |
| `section_number` | TEXT    | e.g., `5.3.2.1`                            |
| `section_title`  | TEXT    | Heading text                               |
| `page_start`     | INTEGER | Starting page in PDF                       |
| `page_end`       | INTEGER | Ending page in PDF                         |
| `content`        | TEXT    | Full section text                          |
| `content_length` | INTEGER | `length(content)` — for stats/filtering    |
| `parent_section` | TEXT    | Parent composite key for tree traversal    |
| `depth`          | INTEGER | Nesting depth: 0 = top-level               |

Unique constraint on `(spec_id, section_number)`.

### `sections_fts` — FTS5 Virtual Table

Content-sync'd FTS5 table for BM25 keyword search. Indexes `section_title` and `content` columns from `sections`.

Kept in sync automatically via `AFTER INSERT/UPDATE/DELETE` triggers on the `sections` table.

### `vec_sections` — Vector Embeddings (Optional)

Created at runtime **only** when the `sqlite-vec` extension is available. Stores 384-dimensional float embeddings (matching `all-MiniLM-L6-v2` or similar models).

| Column       | Type       | Description                              |
|--------------|------------|------------------------------------------|
| `section_id` | TEXT PK   | References `sections.id`                 |
| `embedding`  | float[384]| Dense vector for similarity search       |

### `ingestion_runs` — Audit Log

Records each data load operation for debugging and reproducibility.

| Column         | Type    | Description                                 |
|----------------|---------|---------------------------------------------|
| `id`           | INTEGER | Auto-incremented PK                         |
| `spec_id`      | TEXT    | Which spec was ingested (nullable)          |
| `source_type`  | TEXT    | `pdf_extraction` or `legacy_migration`      |
| `rows_inserted`| INTEGER | Number of rows written                      |
| `warnings`     | TEXT    | JSON array of warning strings               |
| `started_at`   | TEXT    | ISO 8601 start timestamp (auto-set)         |
| `completed_at` | TEXT    | ISO 8601 completion timestamp               |

---

## ID Conventions

| Concept          | Format                           | Example                   |
|------------------|----------------------------------|---------------------------|
| Spec ID          | `ts_{series}_{number}`           | `ts_24_301`               |
| Section ID       | `{spec_id}:{section_number}`     | `ts_24_301:5.3.2.1`       |
| Parent Section   | Same composite format            | `ts_24_301:5.3.2`         |

The composite `section_id` format enables:
- Globally unique keys across all specs.
- Simple tree traversal by stripping the last dotted segment to find the parent.
- Efficient prefix queries: `WHERE id LIKE 'ts_24_301:%'` returns all sections of a spec.

---

## FTS5 Behaviour

### Content-Sync Mode

The `sections_fts` virtual table uses `content='sections'` mode, meaning it does **not** store its own copy of the text. Instead, it maintains an inverted index that points back to rowids in the `sections` table.

Three triggers (`sections_ai`, `sections_ad`, `sections_au`) keep the FTS index in sync whenever rows are inserted, deleted, or updated in `sections`.

### BM25 Ranking

Queries use SQLite's built-in `bm25()` function:

```sql
SELECT s.id, s.section_title, bm25(sections_fts, 5.0, 1.0) AS score
FROM sections_fts fts
JOIN sections s ON s.rowid = fts.rowid
WHERE sections_fts MATCH 'attach AND procedure'
ORDER BY score
LIMIT 20;
```

Weights: title matches are boosted 5× over body content matches.

### Query Syntax

FTS5 supports:
- **AND/OR**: `attach AND procedure`
- **Phrase**: `"tracking area update"`
- **Prefix**: `authen*`
- **Column filter**: `section_title : attach`
- **NEAR**: `NEAR(attach reject, 10)`

---

## Vector Search (Optional)

When `sqlite-vec` is available at runtime, `initDatabase()` creates the `vec_sections` table and sets `features.vectorSearch = true`.

Typical similarity query:

```sql
SELECT section_id, distance
FROM vec_sections
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 10;
```

The parameter is a 384-float vector (e.g., from `all-MiniLM-L6-v2`).

If `sqlite-vec` is not installed, vector search is silently disabled and only FTS5 keyword search is available. This is the expected state for most deployments.

---

## Schema Versioning

The schema version is stored in SQLite's built-in `PRAGMA user_version`:

| Version | Description                  |
|---------|------------------------------|
| 0       | Empty / uninitialised        |
| 1       | Initial schema (this file)   |

**Migration strategy** for future versions:

1. `initDatabase()` reads `PRAGMA user_version`.
2. If the version is less than the latest, run migration SQL files in order (e.g., `db/migrate_v1_to_v2.sql`).
3. Each migration file ends with `PRAGMA user_version = N;`.
4. Migrations run inside a transaction for atomicity.

---

## File Layout

```
db/
  schema.sql              ← DDL (this schema)
src/db/
  schema.js               ← initDatabase() — applies schema, probes extensions
  connection.js           ← Singleton connection factory (no schema logic)
src/types/
  records.js              ← JSDoc typedefs for SpecRecord, SectionRecord, etc.
data/
  3gpp.db                 ← Runtime database (created on first use, gitignored)
  chunks.json             ← Legacy flat JSON (kept for backward compatibility)
```
