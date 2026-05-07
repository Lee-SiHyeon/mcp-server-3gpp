#!/usr/bin/env python3
"""
Alternative PDF extraction using opendataloader-pdf instead of PyMuPDF.
Produces identical _structure.jsonl format for compatibility with build_section_spans.py.

Usage:
    python scripts/extract_opendataloader.py --single <pdf_path>
    python scripts/extract_opendataloader.py --all

Output:
    data/intermediate/{spec_id}_structure.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

os.environ.setdefault('JAVA_HOME', r'C:\Users\dlxog\tools\jdk-21\jdk-21.0.11+10')
java_bin = os.path.join(os.environ['JAVA_HOME'], 'bin')
os.environ['PATH'] = java_bin + ';' + os.environ.get('PATH', '')

try:
    import opendataloader_pdf
except ImportError:
    print("ERROR: opendataloader-pdf is required.", file=sys.stderr)
    sys.exit(1)

try:
    from common_paths import INTERMEDIATE_DIR, RAW_DIR
except ImportError:
    _scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(_scripts_dir))
    from common_paths import INTERMEDIATE_DIR, RAW_DIR


SECTION_PATTERN = re.compile(r'^(\d+(?:\.\d+)*)\s+(.+?)$', re.MULTILINE)
ANNEX_PATTERN = re.compile(
    r'^(Annex\s+[A-Z](?:\.\d+)*)\s*(?:\((?:normative|informative)\))?\s*:?\s*(.+?)$',
    re.MULTILINE,
)
TOP_LEVEL_HEADINGS = {
    'foreword', 'introduction', 'scope', 'references',
    'definitions', 'abbreviations',
}


def derive_spec_id(filename: str) -> str:
    name = Path(filename).stem.lower()

    m = re.match(r'(ts|tr)_(\d{2})_(\d{3})(?:_(\d+))?(?:_v[\d.]+)?', name)
    if m:
        prefix, series, doc, sub = m.group(1), m.group(2), m.group(3), m.group(4)
        return f"{prefix}_{series}_{doc}_{sub}" if sub else f"{prefix}_{series}_{doc}"

    m = re.match(r'(ts|tr)[\s_]*(\d{2})\.(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    m = re.match(r'(ts|tr)[_\s]*1(\d{2})(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    m = re.match(r'(ts|tr)[_\s]*(\d{2})(\d{3})', name)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

    return re.sub(r'[^a-z0-9]+', '_', name).strip('_')


def extract_version(filename: str) -> str:
    name = Path(filename).stem.lower()
    m = re.search(r'v(\d+\.\d+\.\d+)', name)
    return f"v{m.group(1)}" if m else ""


def extract_section_number(title: str) -> str:
    m = re.match(r'^(\d+(?:\.\d+)*)\s', title)
    if m:
        return m.group(1)
    m = re.match(r'^(Annex\s+[A-Z](?:\.\d+)*)', title, re.IGNORECASE)
    if m:
        return m.group(1)
    return ""


def find_headings_in_text(text: str) -> list[str]:
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


def _call_convert(pdf_path: Path, output_dir: str) -> Path:
    opendataloader_pdf.convert(
        input_path=str(pdf_path),
        output_dir=output_dir,
        format="json",
        table_method="cluster",
        reading_order="xycut",
        keep_line_breaks=False,
        include_header_footer=True,
        quiet=True,
    )
    expected = Path(output_dir) / (pdf_path.stem + ".json")
    if expected.exists():
        return expected
    jsons = list(Path(output_dir).glob("*.json"))
    if jsons:
        return jsons[0]
    raise FileNotFoundError(f"No JSON output found in {output_dir}")


def extract_pdf(pdf_path: Path) -> Path:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"ERROR: PDF not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    spec_id = derive_spec_id(pdf_path.name)
    output_path = INTERMEDIATE_DIR / f"{spec_id}_structure.jsonl"

    with tempfile.TemporaryDirectory(prefix=f"odl_{spec_id}_") as tmpdir:
        try:
            json_path = _call_convert(pdf_path, tmpdir)
        except Exception as exc:
            print(f"ERROR: opendataloader-pdf convert failed for {pdf_path.name}: {exc}",
                  file=sys.stderr)
            sys.exit(1)

        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

    records: list[dict] = []

    total_pages = data.get("number of pages", 0)
    records.append({
        "type": "spec_meta",
        "spec_id": spec_id,
        "title": data.get("title", "") or pdf_path.stem,
        "version": extract_version(pdf_path.name),
        "total_pages": total_pages,
        "source_pdf": pdf_path.name,
    })

    kids = data.get("kids", [])

    toc_entries: list[dict] = []
    heading_kids = [(i, k) for i, k in enumerate(kids) if k.get("type") == "heading"]

    for kid_idx, kid in heading_kids:
        content = kid.get("content", "").strip()
        if not content:
            continue
        level = kid.get("heading level", 1)
        page = kid.get("page number", 0)
        section_number = extract_section_number(content)
        toc_entries.append({
            "level": level,
            "title": content,
            "page": page,
            "section_number": section_number,
            "_kid_idx": kid_idx,
        })

    toc_entries.sort(key=lambda e: (e["page"], e["_kid_idx"]))

    if not toc_entries:
        records.append({
            "type": "extraction_warning",
            "message": "No heading elements found in opendataloader-pdf output",
            "spec_id": spec_id,
        })

    for i, entry in enumerate(toc_entries):
        records.append({
            "type": "toc_entry",
            "source": "heading_scan",
            "sort_order": i,
            "level": entry["level"],
            "title": entry["title"],
            "page": entry["page"],
            "section_number": entry["section_number"],
        })

    pages_map: dict[int, list[str]] = defaultdict(list)
    for kid in kids:
        ktype = kid.get("type", "")
        if ktype in ("header", "footer"):
            continue
        content = kid.get("content", "")
        if not content:
            continue
        page_num = kid.get("page number", 0)
        if page_num > 0:
            pages_map[page_num].append(content)

    for page_num in range(1, total_pages + 1):
        text = "\n".join(pages_map.get(page_num, []))
        headings = find_headings_in_text(text)
        records.append({
            "type": "page_text",
            "page_number": page_num,
            "text": text,
            "headings_found": headings,
        })

    with open(output_path, 'w', encoding='utf-8') as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

    toc_count = len(toc_entries)
    page_count = total_pages
    print(f"  \u2713 {spec_id}: {toc_count} TOC entries, {page_count} pages \u2192 {output_path.name}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract structured data from 3GPP PDFs using opendataloader-pdf.",
        epilog="Output: data/intermediate/{spec_id}_structure.jsonl",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--single",
        type=Path,
        help="Path to a single 3GPP specification PDF file",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Process all PDF files in raw/",
    )
    args = parser.parse_args()

    if args.single:
        extract_pdf(args.single)
    else:
        pdf_files = sorted(RAW_DIR.glob("*.pdf"))
        if not pdf_files:
            print(f"No PDF files found in {RAW_DIR}", file=sys.stderr)
            sys.exit(1)

        print(f"Processing {len(pdf_files)} PDF(s) from {RAW_DIR}\n")
        succeeded = 0
        failed: list[str] = []
        for pdf_path in pdf_files:
            print(f"Extracting: {pdf_path.name}")
            try:
                extract_pdf(pdf_path)
                succeeded += 1
            except SystemExit:
                failed.append(pdf_path.name)
            except Exception as exc:
                print(f"  [ERROR] {pdf_path.name}: {exc}", file=sys.stderr)
                failed.append(pdf_path.name)

        print(f"\nDone. {succeeded} succeeded, {len(failed)} failed.")
        if failed:
            for name in failed:
                print(f"  - {name}")


if __name__ == "__main__":
    main()
