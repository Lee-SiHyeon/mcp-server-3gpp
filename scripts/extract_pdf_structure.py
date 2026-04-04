#!/usr/bin/env python3
"""
Structured PDF extraction for 3GPP specifications.

Extracts TOC, per-page text, and metadata into a JSONL file suitable
for downstream section-boundary reconciliation (build_section_spans.py).

Usage:
    python scripts/extract_pdf_structure.py <pdf_path>
    python scripts/extract_pdf_structure.py raw/ts_124301v18.9.0.pdf

Output:
    data/intermediate/{spec_id}_structure.jsonl

Record types emitted:
    spec_meta          — one per file: spec ID, title, version, page count
    toc_entry          — one per TOC heading: level, title, page, section_number
    page_text          — one per page: page number, full text, headings found
    extraction_warning — diagnostic notes (empty TOC, fallback used, etc.)

Requirements:
    pip install pymupdf
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF is required. Install with: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

# Import centralized paths
# Support both direct execution and import from other scripts
try:
    from common_paths import INTERMEDIATE_DIR
except ImportError:
    # When run directly, scripts/ may not be on sys.path
    _scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(_scripts_dir))
    from common_paths import INTERMEDIATE_DIR


# ---------------------------------------------------------------------------
# 3GPP heading patterns
# ---------------------------------------------------------------------------

# Numbered sections like "5.3.2 Some title"
SECTION_PATTERN = re.compile(r'^(\d+(?:\.\d+)*)\s+(.+?)$', re.MULTILINE)

# Annex sections like "Annex A (normative): Foo bar"
ANNEX_PATTERN = re.compile(
    r'^(Annex\s+[A-Z](?:\.\d+)*)\s*(?:\((?:normative|informative)\))?\s*:?\s*(.+?)$',
    re.MULTILINE,
)

# Top-level unnumbered headings common in 3GPP specs
TOP_LEVEL_HEADINGS = {
    'foreword', 'introduction', 'scope', 'references',
    'definitions', 'abbreviations',
}


# ---------------------------------------------------------------------------
# Spec ID / version derivation
# ---------------------------------------------------------------------------

def derive_spec_id(filename: str) -> str:
    """
    Derive normalized spec ID from filename.

    Examples:
        "ts_124301_v18.9.0_LTE_NAS.pdf" → "ts_24_301"
        "ts_124501v18.2.0.pdf"           → "ts_24_501"
        "TS 24.301 v18.9.0.pdf"          → "ts_24_301"
        "ts_136331_v18.5.0.pdf"          → "ts_36_331"
        "ts_24_301_v18.9.0.pdf"          → "ts_24_301"
        "tr_38_901_v18.2.0.pdf"          → "tr_38_901"
        "ts_38_321_v18.3.0.pdf"          → "ts_38_321"
    """
    name = Path(filename).stem.lower()

    # Try "{type}_XX_YYY_v..." underscore-separated format (download_etsi_specs.py output)
    # Matches: ts_24_301_v18.9.0, tr_38_901_v18.2.0, ts_38_321_v18.3.0
    m = re.match(r'(ts|tr)_(\d{2})_(\d{3})(?:_(\d+))?(?:_v[\d.]+)?', name)
    if m:
        prefix = m.group(1)
        series = m.group(2)
        doc = m.group(3)
        sub = m.group(4)
        if sub:
            return f"{prefix}_{series}_{doc}_{sub}"
        return f"{prefix}_{series}_{doc}"

    # Try "TS XX.YYY" or "TR XX.YYY" dotted format  (e.g. "ts 24.301")
    m = re.match(r'(ts|tr)[\s_]*(\d{2})\.(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    # Try "{type}_1XXYYZ" 3GPP archive format — 6-digit number with leading 1
    m = re.match(r'(ts|tr)[_\s]*1(\d{2})(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    # Try "{type}_XXYYZ" without leading 1
    m = re.match(r'(ts|tr)[_\s]*(\d{2})(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    # Fallback: sanitize the stem
    return re.sub(r'[^a-z0-9]+', '_', name).strip('_')


def extract_version(filename: str) -> str:
    """
    Pull version string from filename.

    Examples:
        "ts_124301_v18.9.0_LTE_NAS.pdf" → "v18.9.0"
        "ts_124301v18.2.0.pdf"           → "v18.2.0"
        "TS 24.301 v18.9.0.pdf"          → "v18.9.0"
        "foo.pdf"                        → ""
    """
    name = Path(filename).stem.lower()
    m = re.search(r'v(\d+\.\d+\.\d+)', name)
    if m:
        return f"v{m.group(1)}"
    return ""


# ---------------------------------------------------------------------------
# TOC extraction with fallback
# ---------------------------------------------------------------------------

def extract_section_number(title: str) -> str:
    """Extract section number from title like '5.3.2 Some title' → '5.3.2'."""
    m = re.match(r'^(\d+(?:\.\d+)*)\s', title)
    if m:
        return m.group(1)
    m = re.match(r'^(Annex\s+[A-Z](?:\.\d+)*)', title, re.IGNORECASE)
    if m:
        return m.group(1)
    return ""


def normalize_toc(toc_raw: list) -> list[dict]:
    """Convert PyMuPDF TOC format [level, title, page] to dicts with section_number."""
    result: list[dict] = []
    for level, title, page in toc_raw:
        section_number = extract_section_number(title)
        result.append({
            "level": level,
            "title": title.strip(),
            "page": page,
            "section_number": section_number,
        })
    return result


def extract_toc_from_headings(doc) -> list[dict]:
    """Fallback: scan first 15 pages for heading patterns when PDF TOC is absent/sparse."""
    headings: list[dict] = []
    scan_pages = min(len(doc), 15)
    for page_idx in range(scan_pages):
        page = doc[page_idx]
        text = page.get_text()
        for line in text.split('\n'):
            line = line.strip()
            m = SECTION_PATTERN.match(line)
            if m:
                sec_num = m.group(1)
                depth = sec_num.count('.') + 1
                headings.append({
                    "level": depth,
                    "title": line,
                    "page": page_idx + 1,
                    "section_number": sec_num,
                })
                continue
            m = ANNEX_PATTERN.match(line)
            if m:
                headings.append({
                    "level": 1,
                    "title": line,
                    "page": page_idx + 1,
                    "section_number": m.group(1),
                })
    return headings


def extract_toc(doc) -> list[dict]:
    """Extract TOC from PDF.  Falls back to heading regex if TOC is empty/sparse."""
    toc = doc.get_toc()
    if toc and len(toc) > 5:
        return normalize_toc(toc)
    return extract_toc_from_headings(doc)


# ---------------------------------------------------------------------------
# Page text extraction with heading detection
# ---------------------------------------------------------------------------

def find_headings_in_text(text: str) -> list[str]:
    """Find section headings present in a page's text."""
    headings: list[str] = []
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        if SECTION_PATTERN.match(line):
            headings.append(line)
        elif ANNEX_PATTERN.match(line):
            headings.append(line)
        elif line.lower() in TOP_LEVEL_HEADINGS:
            headings.append(line)
    return headings


def extract_pages(doc, spec_id: str) -> list[dict]:
    """Extract text from each page with heading detection."""
    pages: list[dict] = []
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        try:
            text = page.get_text()
        except Exception as exc:
            print(f"  [WARN] {spec_id} page {page_idx + 1}: text extraction failed: {exc}",
                  file=sys.stderr)
            text = ""
        headings = find_headings_in_text(text)
        pages.append({
            "type": "page_text",
            "page_number": page_idx + 1,
            "text": text,
            "headings_found": headings,
        })
    return pages


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------

def extract_pdf(pdf_path: Path) -> Path:
    """
    Main extraction entry point.

    Reads a 3GPP PDF, writes structured JSONL to data/intermediate/.
    Returns the output path.

    This function is importable — used by extract_all.py.
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"ERROR: PDF not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    spec_id = derive_spec_id(pdf_path.name)
    output_path = INTERMEDIATE_DIR / f"{spec_id}_structure.jsonl"

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        print(f"ERROR: Cannot open PDF {pdf_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    records: list[dict] = []

    # 1. Spec metadata
    meta = doc.metadata or {}
    records.append({
        "type": "spec_meta",
        "spec_id": spec_id,
        "title": meta.get("title", "") or pdf_path.stem,
        "version": extract_version(pdf_path.name),
        "total_pages": len(doc),
        "source_pdf": pdf_path.name,
    })

    # 2. TOC
    raw_toc = doc.get_toc()
    toc_entries = extract_toc(doc)

    if not toc_entries:
        records.append({
            "type": "extraction_warning",
            "message": "TOC empty and no headings found in first 10 pages",
            "spec_id": spec_id,
        })
    elif not raw_toc or len(raw_toc) <= 5:
        # We have entries but they came from the regex fallback
        records.append({
            "type": "extraction_warning",
            "message": "TOC empty, using regex fallback",
            "spec_id": spec_id,
        })

    toc_source = "pdf_toc" if (raw_toc and len(raw_toc) > 5) else "heading_scan"
    for i, entry in enumerate(toc_entries):
        records.append({"type": "toc_entry", "source": toc_source, "sort_order": i, **entry})

    # 3. Page text
    pages = extract_pages(doc, spec_id)
    records.extend(pages)

    doc.close()

    # Write JSONL (UTF-8, one JSON object per line)
    with open(output_path, 'w', encoding='utf-8') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

    print(f"  \u2713 {spec_id}: {len(toc_entries)} TOC entries, {len(pages)} pages \u2192 {output_path.name}")
    return output_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract structured data (TOC + per-page text) from a 3GPP PDF.",
        epilog="Output: data/intermediate/{spec_id}_structure.jsonl",
    )
    parser.add_argument(
        "pdf_path",
        type=Path,
        help="Path to a 3GPP specification PDF file",
    )
    args = parser.parse_args()

    extract_pdf(args.pdf_path)


if __name__ == "__main__":
    main()
