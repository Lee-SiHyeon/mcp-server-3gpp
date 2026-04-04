#!/usr/bin/env python3
"""
ETSI 3GPP specification PDF downloader.

Converts 3GPP spec numbers (e.g. TS 24.301) to ETSI numbering, discovers
the latest published (_60) version from the ETSI delivery server, downloads
the PDF, and copies it to raw/ for the extraction pipeline.

Usage examples:
    python scripts/download_etsi_specs.py --spec "24.301,38.331,23.501"
    python scripts/download_etsi_specs.py --spec "24.301" --type ts
    python scripts/download_etsi_specs.py --series 23 --type ts
    python scripts/download_etsi_specs.py --spec "38.901" --type tr
    python scripts/download_etsi_specs.py --latest-only
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

# ---------------------------------------------------------------------------
# Path setup — reuse project conventions from common_paths.py
# ---------------------------------------------------------------------------
_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from common_paths import PROJECT_ROOT, RAW_DIR, DATA_DIR

PDFS_DIR = DATA_DIR / "pdfs"

# Ensure output directories exist
for _d in [RAW_DIR, PDFS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Use *requests* if available (preferred), else fall back to urllib
# ---------------------------------------------------------------------------
try:
    import requests

    _HAS_REQUESTS = True
except ImportError:
    import urllib.request
    import urllib.error

    _HAS_REQUESTS = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
ETSI_BASE = "https://www.etsi.org/deliver/"
USER_AGENT = "Mozilla/5.0 (compatible; 3GPP-Downloader/1.0)"
MAX_RETRIES = 3
INITIAL_BACKOFF_S = 2.0  # seconds; doubles on each retry
REQUEST_TIMEOUT_S = 60
INTER_DOWNLOAD_DELAY_S = 1.5  # polite delay between downloads

# Published-version suffix used by ETSI
PUBLISHED_SUFFIX = "_60"

# ---------------------------------------------------------------------------
# HTTP helpers (thin wrapper so the rest of the code is transport-agnostic)
# ---------------------------------------------------------------------------


def _http_get(url: str, *, stream: bool = False, timeout: int = REQUEST_TIMEOUT_S) -> "_HTTPResponse":
    """GET *url* with retries & exponential backoff on 403/429/5xx."""
    last_exc: Optional[Exception] = None
    for attempt in range(MAX_RETRIES):
        try:
            if _HAS_REQUESTS:
                resp = requests.get(
                    url,
                    headers={"User-Agent": USER_AGENT},
                    timeout=timeout,
                    stream=stream,
                )
                if resp.status_code == 404:
                    return _HTTPResponse(status=404, content=b"", text="")
                if resp.status_code in (403, 429) or resp.status_code >= 500:
                    raise _RetryableHTTPError(resp.status_code, url)
                resp.raise_for_status()
                return _HTTPResponse(
                    status=resp.status_code,
                    content=resp.content if not stream else b"",
                    text=resp.text if not stream else "",
                    _requests_resp=resp if stream else None,
                )
            else:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                resp_obj = urllib.request.urlopen(req, timeout=timeout)
                data = resp_obj.read()
                return _HTTPResponse(
                    status=resp_obj.status,
                    content=data,
                    text=data.decode("utf-8", errors="replace"),
                )
        except _RetryableHTTPError as exc:
            last_exc = exc
            wait = INITIAL_BACKOFF_S * (2 ** attempt)
            print(f"    HTTP {exc.status} — retrying in {wait:.0f}s ({attempt + 1}/{MAX_RETRIES})")
            time.sleep(wait)
        except (ConnectionError, OSError) as exc:
            last_exc = exc
            wait = INITIAL_BACKOFF_S * (2 ** attempt)
            print(f"    Connection error — retrying in {wait:.0f}s ({attempt + 1}/{MAX_RETRIES})")
            time.sleep(wait)
        except Exception:
            if not _HAS_REQUESTS:
                # urllib may raise urllib.error.HTTPError
                import urllib.error  # noqa: F811 (already imported above in fallback branch)

                # re-check for 404 specifically
                raise
            raise
    # Exhausted retries
    raise RuntimeError(f"Failed after {MAX_RETRIES} retries: {url}") from last_exc


class _RetryableHTTPError(Exception):
    def __init__(self, status: int, url: str) -> None:
        self.status = status
        super().__init__(f"HTTP {status} for {url}")


class _HTTPResponse:
    """Minimal response wrapper."""

    def __init__(
        self,
        status: int,
        content: bytes,
        text: str,
        _requests_resp: Any = None,
    ) -> None:
        self.status = status
        self.content = content
        self.text = text
        self._requests_resp = _requests_resp

    def iter_content(self, chunk_size: int = 8192):
        """Yield chunks — only valid when the underlying request used stream=True."""
        if self._requests_resp is not None:
            yield from self._requests_resp.iter_content(chunk_size=chunk_size)
        else:
            # content was already fully read
            for i in range(0, len(self.content), chunk_size):
                yield self.content[i : i + chunk_size]


# ---------------------------------------------------------------------------
# 3GPP → ETSI number conversion
# ---------------------------------------------------------------------------


def parse_spec_id(spec_str: str) -> tuple[int, int, Optional[int]]:
    """Parse a 3GPP spec string like ``24.301`` or ``23.700-21`` into
    (series, doc_num, sub_part | None).

    Returns:
        (series, doc_num, sub_part) — e.g. (24, 301, None) or (23, 700, 21)
    """
    spec_str = spec_str.strip()
    m = re.match(r"^(\d+)\.(\d+)(?:-(\d+))?$", spec_str)
    if not m:
        raise ValueError(f"Invalid 3GPP spec format: {spec_str!r}  (expected NN.NNN or NN.NNN-NN)")
    series = int(m.group(1))
    doc_num = int(m.group(2))
    sub_part = int(m.group(3)) if m.group(3) else None
    return series, doc_num, sub_part


def spec_to_etsi_num(series: int, doc_num: int, sub_part: Optional[int] = None) -> str:
    """Convert 3GPP series/doc to ETSI number string.

    ETSI number = 100000 + series*1000 + doc_num
    For sub-parts (e.g. 34.123-1), ETSI appends the zero-padded sub-part:
        ETSI = str(base) + sub_part zero-padded to 2 digits
        e.g. 34.123-1 → base=134123, etsi_num = "13412301"

    Without sub-part the number is just the base as a string.
    """
    base = 100000 + series * 1000 + doc_num
    if sub_part is not None:
        return f"{base}{sub_part:02d}"
    return str(base)


def etsi_range_dir(etsi_num: str) -> str:
    """Compute the ETSI range directory name.

    For ETSI number 124301 → range is 124300_124399
    For 13412301 (8-digit with sub-part) → 13412300_13412399
    """
    num = int(etsi_num)
    range_start = (num // 100) * 100
    range_end = range_start + 99
    return f"{range_start}_{range_end}"


# ---------------------------------------------------------------------------
# Version discovery
# ---------------------------------------------------------------------------

# Matches version directories like  18.09.00_60/
_VERSION_DIR_RE = re.compile(r"(\d{2}\.\d{2}\.\d{2})_60/?")


def _version_sort_key(ver_str: str) -> tuple[int, ...]:
    """Sort key for version strings like '18.09.00'."""
    return tuple(int(p) for p in ver_str.split("."))


def discover_latest_version(spec_type: str, etsi_num: str) -> Optional[str]:
    """Fetch the ETSI version directory listing and return the latest published
    version string (e.g. ``18.09.00``), or *None* if nothing found.
    """
    range_dir = etsi_range_dir(etsi_num)
    listing_url = f"{ETSI_BASE}etsi_{spec_type}/{range_dir}/{etsi_num}/"

    try:
        resp = _http_get(listing_url)
    except Exception as exc:
        print(f"    [WARN] Could not reach version listing: {exc}")
        return None

    if resp.status == 404:
        print(f"    [WARN] Version listing not found (404): {listing_url}")
        return None

    versions = _VERSION_DIR_RE.findall(resp.text)
    if not versions:
        print(f"    [WARN] No published (_60) versions found at {listing_url}")
        return None

    # De-duplicate and sort descending
    unique_versions = sorted(set(versions), key=_version_sort_key, reverse=True)
    return unique_versions[0]


# ---------------------------------------------------------------------------
# PDF URL construction
# ---------------------------------------------------------------------------


def build_pdf_url(spec_type: str, etsi_num: str, version: str) -> str:
    """Construct the full PDF download URL on the ETSI server.

    Args:
        spec_type: ``ts`` or ``tr``
        etsi_num:  e.g. ``124301`` or ``13412301``
        version:   e.g. ``18.09.00``

    Returns:
        Full URL like
        https://www.etsi.org/deliver/etsi_ts/124300_124399/124301/18.09.00_60/ts_124301v180900p.pdf
    """
    range_dir = etsi_range_dir(etsi_num)
    ver_compact = version.replace(".", "")  # 18.09.00 → 180900
    pdf_name = f"{spec_type}_{etsi_num}v{ver_compact}p.pdf"
    return f"{ETSI_BASE}etsi_{spec_type}/{range_dir}/{etsi_num}/{version}_60/{pdf_name}"


# ---------------------------------------------------------------------------
# Friendly filename for local storage
# ---------------------------------------------------------------------------


def _version_display(version: str) -> str:
    """Convert ``18.09.00`` to ``18.9.0`` (strip leading zeros per component)."""
    parts = version.split(".")
    return ".".join(str(int(p)) for p in parts)


def local_pdf_name(spec_type: str, spec_str: str, version: str) -> str:
    """Build the local filename.

    E.g. ``ts_24_301_v18.9.0.pdf`` or ``ts_34_123_1_v18.2.0.pdf``
    """
    ver_display = _version_display(version)
    # Replace dots and hyphens in the spec id with underscores
    safe_id = spec_str.replace(".", "_").replace("-", "_")
    return f"{spec_type}_{safe_id}_v{ver_display}.pdf"


# ---------------------------------------------------------------------------
# Download & copy
# ---------------------------------------------------------------------------


def download_pdf(url: str, dest: Path) -> int:
    """Download *url* to *dest*.  Returns file size in bytes."""
    resp = _http_get(url, stream=True)
    if resp.status == 404:
        raise FileNotFoundError(f"PDF not found (404): {url}")

    tmp_dest = dest.with_suffix(".pdf.part")
    try:
        with open(tmp_dest, "wb") as fh:
            downloaded = 0
            for chunk in resp.iter_content(chunk_size=65536):
                fh.write(chunk)
                downloaded += len(chunk)
        # Atomic-ish rename
        tmp_dest.rename(dest)
    except BaseException:
        # Clean up partial file on any error (including KeyboardInterrupt)
        if tmp_dest.exists():
            tmp_dest.unlink()
        raise

    return downloaded


# ---------------------------------------------------------------------------
# High-level orchestrator
# ---------------------------------------------------------------------------


def process_spec(
    spec_str: str,
    spec_type: str,
    *,
    index: int = 1,
    total: int = 1,
    force: bool = False,
) -> Optional[dict[str, Any]]:
    """Download one specification.  Returns a manifest entry dict or None on failure."""
    tag = f"[{index}/{total}]"
    series, doc_num, sub_part = parse_spec_id(spec_str)
    etsi_num = spec_to_etsi_num(series, doc_num, sub_part)
    label = f"{spec_type.upper()} {spec_str}"

    print(f"{tag} {label}  (ETSI {etsi_num})")

    # --- Discover latest version ---
    version = discover_latest_version(spec_type, etsi_num)
    if version is None:
        print(f"{tag} {label} — SKIPPED (no version found)\n")
        return _manifest_entry(spec_str, spec_type, etsi_num, status="no_version_found")

    ver_display = _version_display(version)
    fname = local_pdf_name(spec_type, spec_str, version)
    pdf_dest = PDFS_DIR / fname
    raw_dest = RAW_DIR / fname

    # --- Skip if already present (unless --force) ---
    if not force and pdf_dest.exists() and pdf_dest.stat().st_size > 0:
        size = pdf_dest.stat().st_size
        print(f"{tag} {label} v{ver_display} — SKIP (already downloaded: {fname})")
        # Ensure raw/ copy exists too
        if not raw_dest.exists():
            shutil.copy2(pdf_dest, raw_dest)
            print(f"    → copied to raw/{fname}")
        print()
        return _manifest_entry(
            spec_str, spec_type, etsi_num,
            version=ver_display, url="", filename=fname,
            size=size, status="already_exists",
        )

    # --- Build URL & download ---
    url = build_pdf_url(spec_type, etsi_num, version)
    print(f"{tag} {label} → downloading v{ver_display}...")
    print(f"    URL: {url}")

    try:
        size = download_pdf(url, pdf_dest)
    except FileNotFoundError:
        print(f"{tag} {label} — SKIPPED (PDF not found at expected URL)\n")
        return _manifest_entry(
            spec_str, spec_type, etsi_num,
            version=ver_display, url=url, status="pdf_not_found",
        )
    except Exception as exc:
        print(f"{tag} {label} — FAILED ({exc})\n")
        return _manifest_entry(
            spec_str, spec_type, etsi_num,
            version=ver_display, url=url, status=f"error: {exc}",
        )

    # --- Copy to raw/ for the extraction pipeline ---
    shutil.copy2(pdf_dest, raw_dest)
    size_mb = size / (1024 * 1024)
    print(f"{tag} {label} v{ver_display} — OK ({size_mb:.1f} MB)")
    print(f"    → {pdf_dest.relative_to(PROJECT_ROOT)}")
    print(f"    → {raw_dest.relative_to(PROJECT_ROOT)}")
    print()

    return _manifest_entry(
        spec_str, spec_type, etsi_num,
        version=ver_display, url=url, filename=fname,
        size=size, status="downloaded",
    )


def _manifest_entry(
    spec: str,
    spec_type: str,
    etsi_num: str,
    *,
    version: str = "",
    url: str = "",
    filename: str = "",
    size: int = 0,
    status: str = "",
) -> dict[str, Any]:
    return {
        "spec": spec,
        "type": spec_type,
        "etsi_num": etsi_num,
        "version": version,
        "url": url,
        "pdf_filename": filename,
        "file_size_bytes": size,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Manifest I/O
# ---------------------------------------------------------------------------


def write_manifest(entries: list[dict[str, Any]]) -> Path:
    manifest_path = PDFS_DIR / "manifest.json"
    payload = {
        "downloaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "specs": entries,
    }
    manifest_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

# A curated list for --latest-only convenience mode (Phase 5 priority specs)
DEFAULT_SPECS: list[tuple[str, str]] = [
    # NAS protocol specs
    ("ts", "24.008"),   # NAS for GSM/UMTS/EPS (2G/3G/4G)
    ("ts", "24.301"),   # NAS for EPS (4G)
    ("ts", "24.501"),   # NAS for 5GS (5G)
    # Architecture specs
    ("ts", "23.401"),   # GPRS enhancements for E-UTRAN (EPC)
    ("ts", "23.501"),   # 5G System architecture
    ("ts", "23.502"),   # 5G procedures
    ("ts", "23.503"),   # 5G policy framework
    # RRC specs
    ("ts", "36.331"),   # LTE RRC
    ("ts", "38.331"),   # NR RRC
    # 5G NR Layer 2 specs
    ("ts", "38.300"),   # NR/NG-RAN overall description
    ("ts", "38.321"),   # NR MAC
    ("ts", "38.322"),   # NR RLC
    ("ts", "38.323"),   # NR PDCP
    # Security
    ("ts", "33.501"),   # 5G security architecture
    # Technical Reports
    ("tr", "38.901"),   # Channel model for 0.5-100 GHz
]


def _build_spec_list(args: argparse.Namespace) -> list[tuple[str, str]]:
    """Resolve CLI arguments into a list of (type, spec_str) pairs."""
    spec_type = args.type.lower()

    if args.spec:
        raw = [s.strip() for s in args.spec.split(",") if s.strip()]
        return [(spec_type, s) for s in raw]

    if args.series is not None:
        # Discover all specs in a series requires crawling — not practical.
        # Instead, generate the "well-known" range NN.001 … NN.999
        # and let the version-discovery step filter out non-existent ones.
        # For practicality we only try round numbers that commonly exist.
        print(f"[INFO] Series-wide download for series {args.series} is best-effort;")
        print("       many numbers will 404 and be skipped.\n")
        specs = []
        # Common doc numbers within a series (widely used 3GPP convention)
        for doc in list(range(101, 200)) + list(range(200, 310)) + list(range(400, 520)) + list(range(501, 600)):
            specs.append((spec_type, f"{args.series}.{doc}"))
        return specs

    # --latest-only (default)
    return list(DEFAULT_SPECS)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Download 3GPP specification PDFs from the ETSI delivery server.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--spec",
        type=str,
        default=None,
        help='Comma-separated 3GPP spec numbers, e.g. "24.301,38.331,23.501"',
    )
    p.add_argument(
        "--type",
        type=str,
        default="ts",
        choices=["ts", "tr"],
        help="Specification type: ts (Technical Specification) or tr (Technical Report). Default: ts",
    )
    p.add_argument(
        "--series",
        type=int,
        default=None,
        help="Download all well-known specs in a 3GPP series (e.g. 23, 24, 38).",
    )
    p.add_argument(
        "--latest-only",
        action="store_true",
        default=False,
        help="Download a curated list of important specs (default when no --spec/--series given).",
    )
    p.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Re-download even if the file already exists locally.",
    )
    return p.parse_args(argv)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv)
    spec_list = _build_spec_list(args)

    print("=" * 64)
    print("  ETSI 3GPP Specification PDF Downloader")
    print("=" * 64)
    print(f"  Specs to process : {len(spec_list)}")
    print(f"  PDF output       : {PDFS_DIR.relative_to(PROJECT_ROOT)}/")
    print(f"  Pipeline copy    : {RAW_DIR.relative_to(PROJECT_ROOT)}/")
    print("=" * 64)
    print()

    manifest_entries: list[dict[str, Any]] = []

    for idx, (stype, spec_str) in enumerate(spec_list, start=1):
        entry = process_spec(
            spec_str,
            stype,
            index=idx,
            total=len(spec_list),
            force=args.force,
        )
        if entry is not None:
            manifest_entries.append(entry)

        # Polite delay between specs (skip after the last one)
        if idx < len(spec_list):
            time.sleep(INTER_DOWNLOAD_DELAY_S)

    # Write manifest
    manifest_path = write_manifest(manifest_entries)

    # Summary
    downloaded = sum(1 for e in manifest_entries if e["status"] == "downloaded")
    skipped = sum(1 for e in manifest_entries if e["status"] == "already_exists")
    failed = sum(1 for e in manifest_entries if e["status"] not in ("downloaded", "already_exists"))

    print("=" * 64)
    print("  Download Summary")
    print("=" * 64)
    print(f"  Downloaded  : {downloaded}")
    print(f"  Skipped     : {skipped}")
    print(f"  Failed/404  : {failed}")
    print(f"  Manifest    : {manifest_path.relative_to(PROJECT_ROOT)}")
    print("=" * 64)
    print()
    print("Next steps:")
    print("  python scripts/extract_all.py     # extract text from PDFs")
    print("  python scripts/create_chunks_simple.py  # chunk for embeddings")


if __name__ == "__main__":
    main()
