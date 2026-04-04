# Intermediate Extraction Data

This directory holds JSONL files produced by the PDF extraction pipeline.
They are **generated artifacts** — not committed to git (see `.gitignore`).

## Pipeline Overview

```
raw/*.pdf
    │
    ▼  python scripts/extract_pdf_structure.py <pdf>
    │  (or: python scripts/extract_all.py for batch)
    │
data/intermediate/{spec_id}_structure.jsonl
    │
    ▼  python scripts/build_section_spans.py <spec_id>
    │  (or: python scripts/build_section_spans.py --all)
    │
data/intermediate/{spec_id}_sections.jsonl
    │
    ▼  (future) DB loader
    │
data/specs.sqlite  (or chunks.json)
```

## File Formats

### `{spec_id}_structure.jsonl`

One JSON object per line. Record types:

#### `spec_meta` (exactly one per file)

| Field         | Type   | Description                              |
|---------------|--------|------------------------------------------|
| `type`        | string | Always `"spec_meta"`                     |
| `spec_id`     | string | Normalized ID, e.g. `"ts_24_301"`        |
| `title`       | string | PDF metadata title or filename stem      |
| `version`     | string | Version extracted from filename, e.g. `"v18.9.0"` |
| `total_pages` | int    | Total page count in the PDF              |
| `source_pdf`  | string | Original PDF filename                    |

#### `toc_entry` (one per TOC heading)

| Field            | Type   | Description                                  |
|------------------|--------|----------------------------------------------|
| `type`           | string | Always `"toc_entry"`                         |
| `level`          | int    | Nesting depth (1 = top-level chapter)        |
| `title`          | string | Full heading text, e.g. `"5.3 Foo bar"`      |
| `page`           | int    | 1-based page number where heading appears    |
| `section_number` | string | Extracted number, e.g. `"5.3"` or `"Annex A"` |
| `source`         | string | `"pdf_toc"` or `"heading_scan"`              |
| `sort_order`     | int    | Order index within the TOC                   |

#### `page_text` (one per page)

| Field            | Type     | Description                                |
|------------------|----------|--------------------------------------------|
| `type`           | string   | Always `"page_text"`                       |
| `page_number`    | int      | 1-based page number                        |
| `text`           | string   | Full extracted text content of the page     |
| `headings_found` | string[] | Section headings detected on this page     |

#### `extraction_warning` (zero or more)

| Field     | Type   | Description                               |
|-----------|--------|-------------------------------------------|
| `type`    | string | Always `"extraction_warning"`             |
| `message` | string | Human-readable diagnostic message         |
| `spec_id` | string | Spec ID this warning pertains to          |

### `{spec_id}_sections.jsonl`

One JSON object per line. Each line is a reconciled section span:

| Field            | Type   | Description                                          |
|------------------|--------|------------------------------------------------------|
| `section_id`     | string | Unique ID: `"{spec_id}:{section_number}"`            |
| `spec_id`        | string | Normalized spec ID                                   |
| `section_number` | string | e.g. `"5.3.2"` or `"Annex A"`                       |
| `section_title`  | string | Title without the section number prefix              |
| `page_start`     | int    | First page of the section (1-based)                  |
| `page_end`       | int    | Last page of the section (1-based)                   |
| `depth`          | int    | Nesting depth (1 = chapter, 2 = sub-section, etc.)   |
| `parent_section` | string | Parent section_id, or `""` for top-level sections    |
| `content`        | string | Full concatenated text of the section                |
| `content_length` | int    | Character count of `content`                         |
| `brief`          | string | First 200 characters of `content` (trimmed)          |

## How to Regenerate

```bash
# Single PDF
python scripts/extract_pdf_structure.py raw/ts_124301v18.9.0.pdf
python scripts/build_section_spans.py ts_24_301

# All PDFs in raw/
python scripts/extract_all.py
python scripts/build_section_spans.py --all
```

## Relationship to Final Data

These JSONL files are **pre-processing artifacts**. The downstream step
(not yet implemented) will load `_sections.jsonl` into a SQLite database
or merge into `data/chunks.json` for the MCP server to serve.

## Note

All `.jsonl` files in this directory are listed in `.gitignore` and should
not be committed. Only this README is tracked.
