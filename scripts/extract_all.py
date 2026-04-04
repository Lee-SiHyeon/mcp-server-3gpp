#!/usr/bin/env python3
"""Extract all PDFs in raw/ directory and build section spans."""

from __future__ import annotations

import sys
import time
from pathlib import Path

_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from common_paths import RAW_DIR
from extract_pdf_structure import extract_pdf
from build_section_spans import process_spec, discover_spec_ids


def main() -> None:
    pdf_files = sorted(RAW_DIR.glob("*.pdf"))

    if not pdf_files:
        print(f"No PDF files found in {RAW_DIR}", file=sys.stderr)
        print("Place 3GPP specification PDFs in the raw/ directory and run again.",
              file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(pdf_files)} PDF file(s) in {RAW_DIR}\n")

    succeeded = 0
    failed: list[tuple[str, str]] = []
    t0 = time.monotonic()

    for pdf_path in pdf_files:
        print(f"[1/2] Extracting: {pdf_path.name}")
        try:
            extract_pdf(pdf_path)
            succeeded += 1
        except SystemExit:
            failed.append((pdf_path.name, "extraction error (see above)"))
        except Exception as exc:
            print(f"  [ERROR] {pdf_path.name}: {exc}", file=sys.stderr)
            failed.append((pdf_path.name, str(exc)))

    # Phase 2: build section spans for all extracted specs
    print(f"\n[2/2] Building section spans...")
    spec_ids = discover_spec_ids()
    sections_built = 0
    for sid in spec_ids:
        try:
            process_spec(sid)
            sections_built += 1
        except Exception as exc:
            print(f"  [ERROR] {sid}: {exc}", file=sys.stderr)

    elapsed = time.monotonic() - t0

    # Summary
    print("\n" + "=" * 60)
    print(f"Extraction complete in {elapsed:.1f}s")
    print(f"  PDFs extracted: {succeeded}/{len(pdf_files)}")
    print(f"  Section spans:  {sections_built}/{len(spec_ids)}")
    if failed:
        print(f"  Failed:         {len(failed)}/{len(pdf_files)}")
        for name, reason in failed:
            print(f"    - {name}: {reason}")
    print("=" * 60)


if __name__ == "__main__":
    main()
