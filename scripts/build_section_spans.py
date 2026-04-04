#!/usr/bin/env python3
"""
Section boundary reconciliation for 3GPP specifications.

Reads a *_structure.jsonl file produced by extract_pdf_structure.py and
computes page-aware section spans with full concatenated text.

Usage:
    python scripts/build_section_spans.py ts_24_301
    python scripts/build_section_spans.py --all

Output:
    data/intermediate/{spec_id}_sections.jsonl

Each line is a JSON object describing one section:
    {
        "section_id":      "ts_24_301:5.3",
        "spec_id":         "ts_24_301",
        "section_number":  "5.3",
        "section_title":   "Tracking area updating procedure",
        "page_start":      78,
        "page_end":        95,
        "depth":           2,
        "parent_section":  "ts_24_301:5",
        "content":         "full section text...",
        "content_length":  8500,
        "brief":           "first 200 chars..."
    }

Requirements:
    Only Python stdlib (reads JSONL produced by extract_pdf_structure.py).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Import centralized paths
try:
    from common_paths import INTERMEDIATE_DIR
except ImportError:
    _scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(_scripts_dir))
    from common_paths import INTERMEDIATE_DIR


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _section_depth(section_number: str) -> int:
    """
    Compute depth from a section number.

    "5"       → 1
    "5.3"     → 2
    "5.3.2"   → 3
    "Annex A" → 1
    "Annex A.1" → 2
    """
    if not section_number:
        return 0
    if section_number.lower().startswith("annex"):
        # "Annex A" → 1, "Annex A.1" → 2
        dots = section_number.count('.')
        return dots + 1
    return section_number.count('.') + 1


def _parent_section_number(section_number: str) -> str:
    """
    Derive parent section number.

    "5.3.2"     → "5.3"
    "5.3"       → "5"
    "5"         → ""
    "Annex A.1" → "Annex A"
    "Annex A"   → ""
    """
    if not section_number:
        return ""
    # Annex handling
    if section_number.lower().startswith("annex"):
        dot_idx = section_number.rfind('.')
        if dot_idx == -1:
            return ""
        return section_number[:dot_idx]
    # Numbered section
    dot_idx = section_number.rfind('.')
    if dot_idx == -1:
        return ""
    return section_number[:dot_idx]


def _strip_section_number_from_title(title: str, section_number: str) -> str:
    """
    Remove leading section number from a title string.

    "5.3 Tracking area updating" → "Tracking area updating"
    "Annex A (normative): Stuff" → "(normative): Stuff"
    """
    if not section_number:
        return title.strip()
    if title.startswith(section_number):
        return title[len(section_number):].strip()
    return title.strip()


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def load_structure(spec_id: str) -> tuple[list[dict], list[dict], dict | None]:
    """
    Load toc_entry and page_text records from a structure JSONL.

    Returns (toc_entries, page_texts, spec_meta_or_None).
    """
    structure_path = INTERMEDIATE_DIR / f"{spec_id}_structure.jsonl"
    if not structure_path.exists():
        print(f"ERROR: Structure file not found: {structure_path}", file=sys.stderr)
        sys.exit(1)

    toc_entries: list[dict] = []
    page_texts: list[dict] = []
    spec_meta: dict | None = None

    with open(structure_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"  [WARN] {structure_path.name} line {line_num}: bad JSON: {exc}",
                      file=sys.stderr)
                continue

            rtype = record.get("type")
            if rtype == "toc_entry":
                toc_entries.append(record)
            elif rtype == "page_text":
                page_texts.append(record)
            elif rtype == "spec_meta":
                spec_meta = record

    # Warn if low TOC count
    if spec_meta and len(toc_entries) < 10 and toc_entries:
        print(f"  [WARN] {spec_id}: low TOC count ({len(toc_entries)} entries)", file=sys.stderr)

    return toc_entries, page_texts, spec_meta


def _find_heading_offset(page_text: str, section_number: str) -> int:
    """
    Find character offset of a section heading within page text.

    Returns 0 if heading not found (conservative: assume top of page).
    """
    if not section_number:
        return 0

    # Try to locate the heading line
    for i, raw_line in enumerate(page_text.split('\n')):
        line = raw_line.strip()
        if not line:
            continue
        # Match numbered heading
        m = re.match(r'^(\d+(?:\.\d+)*)\s', line)
        if m and m.group(1) == section_number:
            # Return char offset of this line
            offset = page_text.find(raw_line)
            return max(0, offset)
        # Match annex heading
        if section_number.lower().startswith("annex"):
            if line.lower().startswith(section_number.lower()):
                offset = page_text.find(raw_line)
                return max(0, offset)
    return 0


def build_sections(spec_id: str) -> list[dict]:
    """
    Build section span records for a spec.

    Algorithm:
    1. Load TOC entries (sorted by page, then by in-page order) and page texts.
    2. For each TOC entry, determine where its content starts (page + offset).
    3. A section ends where the next sibling-or-higher heading begins.
    4. Concatenate text across spanned pages, trimming at heading boundaries.
    """
    toc_entries, page_texts, spec_meta = load_structure(spec_id)

    if not toc_entries:
        print(f"  [WARN] {spec_id}: no TOC entries — cannot build sections", file=sys.stderr)
        return []

    # Build page lookup: page_number → text
    page_map: dict[int, str] = {}
    for pt in page_texts:
        page_map[pt.get("page_number", pt.get("page"))] = pt.get("text", "")

    total_pages = max(page_map.keys()) if page_map else 0

    # Sort TOC entries by page, then by position within page
    # We use the heading offset within the page as secondary sort key
    enriched: list[dict] = []
    for entry in toc_entries:
        page = entry["page"]
        sec_num = entry.get("section_number", "")
        page_text = page_map.get(page, "")
        offset = _find_heading_offset(page_text, sec_num)
        enriched.append({**entry, "_offset": offset})

    enriched.sort(key=lambda e: (e["page"], e["_offset"]))

    # Build sections
    sections: list[dict] = []

    for idx, entry in enumerate(enriched):
        sec_num = entry.get("section_number", "")
        sec_title = _strip_section_number_from_title(entry.get("title", ""), sec_num)
        page_start = entry["page"]
        offset_start = entry["_offset"]

        # Determine end boundary: next entry at same or higher level
        if idx + 1 < len(enriched):
            next_entry = enriched[idx + 1]
            page_end = next_entry["page"]
            offset_end = next_entry["_offset"]
        else:
            # Last section extends to end of document
            page_end = total_pages
            offset_end = len(page_map.get(total_pages, ""))

        # Concatenate text across spanned pages
        content_parts: list[str] = []
        for pg in range(page_start, page_end + 1):
            pg_text = page_map.get(pg, "")
            if not pg_text:
                continue

            if pg == page_start and pg == page_end:
                # Section starts and ends on same page
                content_parts.append(pg_text[offset_start:offset_end])
            elif pg == page_start:
                # First page: from heading to end of page
                content_parts.append(pg_text[offset_start:])
            elif pg == page_end:
                # Last page: from start of page to next heading
                content_parts.append(pg_text[:offset_end])
            else:
                # Middle pages: full text
                content_parts.append(pg_text)

        content = "\n".join(content_parts).strip()
        depth = _section_depth(sec_num)
        parent_num = _parent_section_number(sec_num)
        parent_id = f"{spec_id}:{parent_num}" if parent_num else ""

        sections.append({
            "section_id": f"{spec_id}:{sec_num}" if sec_num else f"{spec_id}:_untitled_{idx}",
            "spec_id": spec_id,
            "section_number": sec_num,
            "section_title": sec_title,
            "page_start": page_start,
            "page_end": page_end,
            "depth": depth,
            "parent_section": parent_id,
            "content": content,
            "content_length": len(content),
            "brief": content[:200].strip() if content else "",
        })

    return sections


def process_spec(spec_id: str) -> Path:
    """Build sections for one spec and write to JSONL. Returns output path."""
    sections = build_sections(spec_id)
    output_path = INTERMEDIATE_DIR / f"{spec_id}_sections.jsonl"

    with open(output_path, 'w', encoding='utf-8') as f:
        for section in sections:
            f.write(json.dumps(section, ensure_ascii=False) + '\n')

    print(f"  \u2713 {spec_id}: {len(sections)} sections \u2192 {output_path.name}")
    return output_path


def discover_spec_ids() -> list[str]:
    """Find all spec IDs that have structure files in the intermediate directory."""
    spec_ids: list[str] = []
    for p in sorted(INTERMEDIATE_DIR.glob("*_structure.jsonl")):
        # "ts_24_301_structure.jsonl" → "ts_24_301"
        sid = p.stem.removesuffix("_structure")
        spec_ids.append(sid)
    return spec_ids


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build section spans from structured PDF extraction JSONL.",
        epilog="Input: data/intermediate/{spec_id}_structure.jsonl  →  Output: data/intermediate/{spec_id}_sections.jsonl",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "spec_id",
        nargs="?",
        default=None,
        help="Spec ID to process, e.g. ts_24_301",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Process all *_structure.jsonl files in data/intermediate/",
    )
    args = parser.parse_args()

    if args.all:
        spec_ids = discover_spec_ids()
        if not spec_ids:
            print("No *_structure.jsonl files found in data/intermediate/.", file=sys.stderr)
            sys.exit(1)
        print(f"Building sections for {len(spec_ids)} spec(s)...")
        for sid in spec_ids:
            process_spec(sid)
        print(f"\nDone. {len(spec_ids)} spec(s) processed.")
    else:
        if args.spec_id is None:
            parser.error("Provide a spec_id or use --all")
        process_spec(args.spec_id)


if __name__ == "__main__":
    main()
