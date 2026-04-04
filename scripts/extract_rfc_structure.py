#!/usr/bin/env python3
"""Parse RFC TXT files into structured JSONL for DB ingestion.

Reads downloaded RFC TXT files and emits:
  - data/intermediate/rfc_{NNNN}_toc.jsonl    — TOC entries
  - data/intermediate/rfc_{NNNN}_sections.jsonl — full section content

Usage:
    python scripts/extract_rfc_structure.py --rfc 3261
    python scripts/extract_rfc_structure.py --rfc 3261 --rfc 6733 --rfc 8446
    python scripts/extract_rfc_structure.py --all
    python scripts/extract_rfc_structure.py --all --input data/rfcs/ --output data/intermediate/
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# Match body section headers: line must start at column 0 (no leading spaces).
# Supports both RFC styles:
#   "1 Introduction"        (RFC 3261 style: number, 1+ spaces, no dot)
#   "1.  Introduction"      (RFC 6733/8446 style: number, dot, 2+ spaces)
#   "5.3.2.  Foo Bar"
# IMPORTANT: match against RAW (non-stripped) lines so indented TOC entries
# are not accidentally matched.
SECTION_RE = re.compile(r'^(\d+(?:\.\d+)*)\.?\s+(.+?)$')

# TOC line pattern: "5.3.2.  Section title .... 42" (dots and page number at end)
# Allow 1+ spaces after the optional dot.
TOC_LINE_RE = re.compile(
    r'^(\d+(?:\.\d+)*)\.?\s+(.+?)\s*\.{2,}\s*(\d+)\s*$'
)
# Also match simpler TOC lines without filler dots: "5.3.2.  Title 42"
TOC_LINE_SIMPLE_RE = re.compile(
    r'^(\d+(?:\.\d+)*)\.?\s+(.+?)\s+(\d+)\s*$'
)

# Page marker at end of line: "[Page N]"
PAGE_MARKER_RE = re.compile(r'\[Page\s+(\d+)\]', re.IGNORECASE)

# RFC header/footer lines to strip (common pattern in RFC TXT)
RFC_HEADER_RE = re.compile(
    r'^(?:RFC\s+\d+|Network Working Group|Request for Comments|STD:\s*\d+|BCP:\s*\d+|'
    r'Obsoletes:|Updates:|Category:|ISSN:|Internet-Std|'
    r'\S+\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})',
    re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _depth(section_number: str) -> int:
    """Depth from dot count: '1' → 0, '1.2' → 1, '1.2.3' → 2."""
    if not section_number:
        return 0
    return section_number.count('.')


def _parent_number(section_number: str) -> str:
    """Return parent section number or empty string."""
    last_dot = section_number.rfind('.')
    if last_dot < 0:
        return ""
    return section_number[:last_dot]


def _make_spec_id(rfc_number: int) -> str:
    return f"rfc_{rfc_number}"


def _make_section_id(spec_id: str, section_number: str) -> str:
    return f"{spec_id}:{section_number}"


def _brief(content: str, max_len: int = 200) -> str:
    """Return first ~200 chars of content, stripped and normalized."""
    text = ' '.join(content.split())
    if len(text) <= max_len:
        return text
    # Try to cut at sentence boundary
    m = re.search(r'[.!?]\s', text[:max_len])
    if m and m.end() > max_len * 0.4:
        return text[:m.end()].strip()
    # Word boundary fallback
    truncated = text[:max_len]
    last_space = truncated.rfind(' ')
    if last_space > max_len * 0.6:
        return truncated[:last_space] + '…'
    return truncated + '…'


# ---------------------------------------------------------------------------
# TOC extraction
# ---------------------------------------------------------------------------

def extract_toc(lines: list[str]) -> list[dict]:
    """
    Find the Table of Contents block and extract TOC entries.

    Returns list of dicts with keys: section_number, section_title,
    depth, page_estimate, brief.
    """
    toc_start = -1
    toc_end = -1

    # Find "Table of Contents" heading
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r'^Table of Contents\s*$', stripped, re.IGNORECASE):
            toc_start = i + 1
            break

    if toc_start < 0:
        return []

    # TOC ends when we hit a blank line followed by a non-TOC paragraph,
    # or at the first actual section header, or after ~200 lines.
    entries: list[dict] = []
    consecutive_blank = 0

    for i in range(toc_start, min(toc_start + 300, len(lines))):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            consecutive_blank += 1
            if consecutive_blank > 3 and entries:
                toc_end = i
                break
            continue
        consecutive_blank = 0

        # Skip page markers
        if PAGE_MARKER_RE.search(stripped):
            continue

        # Try to match TOC line with filler dots
        m = TOC_LINE_RE.match(stripped)
        if not m:
            m = TOC_LINE_SIMPLE_RE.match(stripped)
        if m:
            sec_num = m.group(1)
            title = m.group(2).strip()
            # Clean trailing dots from title
            title = re.sub(r'\.{2,}\s*$', '', title).strip()
            page = int(m.group(3))
            entries.append({
                "section_number": sec_num,
                "section_title": title,
                "depth": _depth(sec_num),
                "page_estimate": page,
                "brief": "",
            })

    return entries


# ---------------------------------------------------------------------------
# Section body extraction
# ---------------------------------------------------------------------------

def extract_sections(
    lines: list[str],
    spec_id: str,
    toc_entries: list[dict],
) -> list[dict]:
    """
    Scan RFC body for section headers and collect content.

    Returns list of section dicts matching the required JSONL schema.
    """
    # Build set of known section numbers from TOC for validation
    toc_sections: set[str] = {e["section_number"] for e in toc_entries}

    # Track current page number via [Page N] markers
    current_page = 1

    # Collect (line_index, section_number, section_title) tuples
    header_positions: list[tuple[int, str, str]] = []

    for i, line in enumerate(lines):
        # Update page counter
        pm = PAGE_MARKER_RE.search(line)
        if pm:
            try:
                current_page = int(pm.group(1))
            except ValueError:
                pass
            continue

        # Match against raw line (not stripped!) so indented TOC lines are
        # not mistaken for body section headers.
        if not line or line[0] == ' ' or line[0] == '\t':
            continue  # indented → skip (TOC / code / continuation)

        stripped = line.strip()
        if not stripped:
            continue

        m = SECTION_RE.match(line)  # raw line
        if m:
            sec_num = m.group(1)
            title = m.group(2).strip()
            # Clean page-number artifacts from title (e.g. "Introduction    8")
            title = re.sub(r'\s+\d+\s*$', '', title).strip()
            # Reject if title is too short or looks like ABNF / code
            if not title or len(title) < 3:
                continue
            # Only include sections with 1–5 numeric components
            parts = sec_num.split('.')
            if len(parts) > 5:
                continue
            header_positions.append((i, sec_num, title))

    if not header_positions:
        return []

    # Build page map: line_index → page number
    page_at_line: list[int] = []
    pg = 1
    for line in lines:
        pm = PAGE_MARKER_RE.search(line)
        if pm:
            try:
                pg = int(pm.group(1))
            except ValueError:
                pass
        page_at_line.append(pg)
    # Build sections from header positions
    sections: list[dict] = []
    for idx, (line_i, sec_num, sec_title) in enumerate(header_positions):
        # Determine content range
        next_line_i = header_positions[idx + 1][0] if idx + 1 < len(header_positions) else len(lines)

        # Collect content lines between this header and next
        content_lines: list[str] = []
        for j in range(line_i + 1, next_line_i):
            raw = lines[j]
            # Strip page markers
            cleaned = PAGE_MARKER_RE.sub('', raw).rstrip()
            # Skip RFC header/footer lines
            if RFC_HEADER_RE.match(cleaned.strip()):
                continue
            content_lines.append(cleaned)

        # Remove leading/trailing blank lines
        while content_lines and not content_lines[0].strip():
            content_lines.pop(0)
        while content_lines and not content_lines[-1].strip():
            content_lines.pop()

        content = '\n'.join(content_lines).strip()

        page_start = page_at_line[line_i] if line_i < len(page_at_line) else 1
        page_end_i = next_line_i - 1 if next_line_i > 0 else line_i
        page_end = page_at_line[min(page_end_i, len(page_at_line) - 1)]

        parent_num = _parent_number(sec_num)
        parent_id = _make_section_id(spec_id, parent_num) if parent_num else ""

        section_id = _make_section_id(spec_id, sec_num)

        sections.append({
            "section_id": section_id,
            "spec_id": spec_id,
            "section_number": sec_num,
            "section_title": sec_title,
            "page_start": page_start,
            "page_end": page_end,
            "depth": _depth(sec_num),
            "parent_section": parent_id,
            "content": content,
            "content_length": len(content),
            "brief": _brief(content),
        })

    return sections


# ---------------------------------------------------------------------------
# Per-RFC processing
# ---------------------------------------------------------------------------

def process_rfc(rfc_number: int, input_dir: Path, output_dir: Path) -> bool:
    """Process a single RFC. Returns True on success."""
    txt_path = input_dir / f"rfc{rfc_number}.txt"
    meta_path = input_dir / f"rfc{rfc_number}_meta.json"

    if not txt_path.exists():
        print(f"RFC {rfc_number}: TXT not found at {txt_path}, skipping.")
        return False

    print(f"Processing RFC {rfc_number}...")

    # Read metadata
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except ValueError:
            pass

    spec_id = _make_spec_id(rfc_number)
    lines = txt_path.read_text(encoding="utf-8", errors="replace").splitlines()

    # Extract TOC
    toc_entries = extract_toc(lines)
    print(f"  TOC entries found: {len(toc_entries)}")

    # Extract sections
    sections = extract_sections(lines, spec_id, toc_entries)
    print(f"  Sections found: {len(sections)}")

    # Back-fill briefs into TOC entries from section content
    sec_brief_map = {s["section_number"]: s["brief"] for s in sections}
    for toc_entry in toc_entries:
        if not toc_entry["brief"] and toc_entry["section_number"] in sec_brief_map:
            toc_entry["brief"] = sec_brief_map[toc_entry["section_number"]]

    # Write TOC JSONL
    toc_path = output_dir / f"rfc_{rfc_number}_toc.jsonl"
    with toc_path.open("w", encoding="utf-8") as f:
        for entry in toc_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"  Wrote {toc_path}")

    # Write sections JSONL
    sections_path = output_dir / f"rfc_{rfc_number}_sections.jsonl"
    with sections_path.open("w", encoding="utf-8") as f:
        for section in sections:
            f.write(json.dumps(section, ensure_ascii=False) + "\n")
    print(f"  Wrote {sections_path}")

    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Extract RFC TXT into structured JSONL")
    parser.add_argument("--rfc", action="append", type=int, metavar="NUMBER",
                        help="RFC number to process (can be repeated)")
    parser.add_argument("--all", action="store_true",
                        help="Process all RFC TXT files in input directory")
    parser.add_argument("--input", default="data/rfcs/",
                        help="Input directory (default: data/rfcs/)")
    parser.add_argument("--output", default="data/intermediate/",
                        help="Output directory (default: data/intermediate/)")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.all:
        # Discover all rfc*.txt files (not *_meta.json)
        txt_files = sorted(input_dir.glob("rfc*.txt"))
        rfc_numbers = []
        for p in txt_files:
            m = re.match(r'^rfc(\d+)\.txt$', p.name)
            if m:
                rfc_numbers.append(int(m.group(1)))
    elif args.rfc:
        rfc_numbers = args.rfc
    else:
        parser.error("Specify --rfc NUMBER or --all")

    if not rfc_numbers:
        print("No RFC numbers to process.")
        sys.exit(0)

    print(f"Processing {len(rfc_numbers)} RFC(s)...")
    success = 0
    for rfc_number in rfc_numbers:
        if process_rfc(rfc_number, input_dir, output_dir):
            success += 1

    print(f"\nDone. Processed {success}/{len(rfc_numbers)} RFC(s).")


if __name__ == "__main__":
    main()
