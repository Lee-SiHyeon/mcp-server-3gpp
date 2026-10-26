#!/usr/bin/env python3
"""Download RFCs from rfc-editor.org and fetch metadata from IETF Datatracker API.

Usage:
    python scripts/download_rfc.py --rfc 3261
    python scripts/download_rfc.py --rfc 3261 --rfc 6733
    python scripts/download_rfc.py --category SIP
    python scripts/download_rfc.py --all
    python scripts/download_rfc.py --all --output data/rfcs/
    # RFCs cited by the non-RFC specs in the corpus but not yet ingested:
    python scripts/download_rfc.py --from-citations --db data/corpus/3gpp.db --list-only
    python scripts/download_rfc.py --from-citations --db data/corpus/3gpp.db \
        --min-mentions 3 --min-specs 2 --output data/rfcs/

Downloads are skipped when the TXT is already present; requests retry with
backoff on 429/5xx/network errors and fall back to the ietf.org mirror.
Metadata comes from rfc-editor.org/rfc/rfcNNNN.json (incl. obsoleted_by),
falling back to the IETF Datatracker API.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests is required. Install with: pip install requests", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Priority RFC catalogue
# ---------------------------------------------------------------------------

PRIORITY_RFCS = {
    # SIP & VoIP
    3261: "SIP", 3262: "SIP", 3263: "SIP", 3264: "SIP", 3265: "SIP",
    3311: "SIP", 3428: "SIP/IM", 3515: "SIP", 4566: "SDP", 3550: "RTP", 3551: "RTP",
    # Diameter
    6733: "Diameter", 3588: "Diameter", 4005: "Diameter", 4006: "Diameter",
    4072: "Diameter", 5779: "Diameter",
    # RADIUS
    2865: "RADIUS", 2866: "RADIUS", 3162: "RADIUS", 5080: "RADIUS",
    # Security
    7296: "IKEv2", 4301: "IPsec", 4303: "IPsec/ESP",
    8446: "TLS", 9147: "DTLS", 5246: "TLS",
    4251: "SSH", 4252: "SSH", 4253: "SSH", 4254: "SSH",
    # OAuth/OIDC
    6749: "OAuth", 6750: "OAuth", 7519: "JWT", 8693: "OAuth", 9068: "OAuth",
    # HTTP
    9110: "HTTP", 9112: "HTTP", 9113: "HTTP/2", 9114: "HTTP/3",
    7540: "HTTP/2",
    # QUIC
    9000: "QUIC", 9001: "QUIC", 9002: "QUIC",
    # SCTP
    4960: "SCTP", 6096: "SCTP",
    # DNS
    1034: "DNS", 1035: "DNS", 4033: "DNSSEC", 4034: "DNSSEC", 4035: "DNSSEC",
    7858: "DNS/TLS", 8484: "DNS/HTTPS",
    # DHCP
    2131: "DHCPv4", 2132: "DHCPv4", 8415: "DHCPv6",
    # IPv6 & Mobility
    8200: "IPv6", 4443: "ICMPv6", 4291: "IPv6-Addressing",
    6275: "MIPv6", 5944: "MIPv4",
    # Routing
    4271: "BGP", 4760: "BGP-MultiProtocol",
    2328: "OSPF", 5340: "OSPFv3",
    3031: "MPLS", 3032: "MPLS",
    5036: "LDP",
    # NETCONF/YANG
    6241: "NETCONF", 6242: "NETCONF",
    7950: "YANG", 8341: "NETCONF-YANG",
    # SNMP/RADIUS Mgmt
    3411: "SNMP", 3412: "SNMP",
    # XMPP
    6120: "XMPP", 6121: "XMPP",
    # WebRTC
    8825: "WebRTC", 8826: "WebRTC", 8827: "WebRTC", 8834: "WebRTC", 8835: "WebRTC",
    # RTSP
    7826: "RTSP",
    # NTP
    5905: "NTP",
    # NAT/Traversal
    3489: "STUN", 5389: "STUN", 5766: "TURN",
    4787: "NAT-UDP", 5382: "NAT-TCP",
    # GTP related
    3153: "GTP-U-Extension",
    # 464XLAT
    6877: "464XLAT", 6146: "NAT64", 6147: "DNS64", 6052: "IPv6-prefix",
}

# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "mcp-server-3gpp/1.0 (+https://github.com/Lee-SiHyeon/mcp-server-3gpp)"


RETRY_STATUS = {429, 500, 502, 503, 504}


def _get_with_retry(url: str, timeout: int = 30, attempts: int = 4) -> requests.Response | None:
    """GET a URL with exponential backoff; None on 404/410 or repeated failure."""
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            resp = SESSION.get(url, timeout=timeout)
            if resp.status_code in (404, 410):
                return None
            if resp.status_code in RETRY_STATUS and attempt < attempts:
                wait = float(resp.headers.get("Retry-After", delay)) if resp.headers.get("Retry-After", "").isdigit() else delay
                print(f"  {resp.status_code} from {url}, retry {attempt}/{attempts - 1} in {wait:.0f}s")
                time.sleep(wait)
                delay *= 2
                continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            if attempt < attempts:
                print(f"  Request error: {exc}, retry {attempt}/{attempts - 1} in {delay:.0f}s")
                time.sleep(delay)
                delay *= 2
                continue
            print(f"  Failed after {attempts} attempts: {exc}")
            return None
    return None


def _rfc_editor_json(rfc_number: int) -> dict:
    resp = _get_with_retry(f"https://www.rfc-editor.org/rfc/rfc{rfc_number}.json")
    if resp is None:
        return {}
    try:
        data = resp.json()
    except ValueError:
        return {}
    def _nums(values):
        out = []
        for v in values or []:
            m = re.match(r"(?i)rfc\s*0*(\d+)", str(v).strip())
            if m:
                out.append(int(m.group(1)))
        return out
    try:
        pages = int(data.get("page_count") or 0)
    except ValueError:
        pages = 0
    return {
        "rfc_number": rfc_number,
        "title": (data.get("title") or f"RFC {rfc_number}").strip(),
        "abstract": (data.get("abstract") or "").strip(),
        "pages": pages,
        "std_level": data.get("status") or "",
        "date": data.get("pub_date") or "",
        "url": f"https://www.rfc-editor.org/rfc/rfc{rfc_number}.txt",
        "obsoleted_by": _nums(data.get("obsoleted_by")),
        "obsoletes": _nums(data.get("obsoletes")),
    }


def fetch_metadata(rfc_number: int) -> dict:
    """Fetch RFC metadata (rfc-editor JSON first, then IETF Datatracker)."""
    meta = _rfc_editor_json(rfc_number)
    if meta:
        meta["category"] = PRIORITY_RFCS.get(rfc_number, "cited" if rfc_number not in PRIORITY_RFCS else "unknown")
        return meta
    url = f"https://datatracker.ietf.org/api/v1/doc/document/rfc{rfc_number}/?format=json"
    resp = _get_with_retry(url)
    if resp is None:
        return {}
    try:
        data = resp.json()
    except ValueError:
        return {}

    return {
        "rfc_number": rfc_number,
        "title": data.get("title", f"RFC {rfc_number}"),
        "abstract": data.get("abstract", ""),
        "pages": data.get("pages", 0),
        "std_level": data.get("std_level", ""),
        "date": data.get("time", ""),
        "url": f"https://www.rfc-editor.org/rfc/rfc{rfc_number}.txt",
        "category": PRIORITY_RFCS.get(rfc_number, "unknown"),
    }


def download_rfc(rfc_number: int, output_dir: Path) -> dict | None:
    """Download RFC TXT and metadata. Returns metadata dict or None on failure."""
    category = PRIORITY_RFCS.get(rfc_number, "unknown")
    print(f"Downloading RFC {rfc_number} ({category})...")

    txt_url = f"https://www.rfc-editor.org/rfc/rfc{rfc_number}.txt"
    txt_path = output_dir / f"rfc{rfc_number}.txt"
    meta_path = output_dir / f"rfc{rfc_number}_meta.json"

    # Download TXT (rfc-editor first, ietf.org mirror as fallback)
    if not txt_path.exists() or txt_path.stat().st_size == 0:
        resp = _get_with_retry(txt_url) or _get_with_retry(f"https://www.ietf.org/rfc/rfc{rfc_number}.txt")
        if resp is None or not resp.text.strip():
            print(f"  RFC {rfc_number}: TXT not available, skipping.")
            return None
        txt_path.write_text(resp.text, encoding="utf-8")
        print(f"  Saved {txt_path}")
    else:
        print(f"  {txt_path} already exists, skipping download.")

    # Fetch and save metadata
    if not meta_path.exists():
        meta = fetch_metadata(rfc_number)
        if not meta:
            # Build minimal metadata from what we know
            meta = {
                "rfc_number": rfc_number,
                "title": f"RFC {rfc_number}",
                "abstract": "",
                "pages": 0,
                "std_level": "",
                "date": "",
                "url": txt_url,
                "category": category,
            }
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  Saved {meta_path}")
    else:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        print(f"  {meta_path} already exists, skipping fetch.")

    return meta


# Keep the acquisition grammar aligned with extract_cross_refs.js.  In
# particular TS 33.210 spells RFC 2451 as "RFC-2451", and some specifications
# pad the number ("RFC 0768"). int() below canonicalises those padded ids.
CITATION_RE = re.compile(r"\bRFC[\s\-–]*(\d{3,5})\b", re.IGNORECASE)


def cited_rfcs(db_path: Path) -> tuple[dict[int, dict], set[int]]:
    """Scan non-RFC sections for RFC citations.

    Returns ({rfc: {"mentions": n, "specs": {spec_id, ...}}}, rfcs_in_corpus).
    """
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        in_corpus = {int(r[0][4:]) for r in con.execute("SELECT id FROM specs WHERE id LIKE 'rfc\\_%' ESCAPE '\\'")
                     if r[0][4:].isdigit()}
        stats: dict[int, dict] = defaultdict(lambda: {"mentions": 0, "specs": set()})
        for spec_id, content in con.execute("SELECT spec_id, content FROM sections WHERE spec_id NOT LIKE 'rfc\\_%' ESCAPE '\\'"):
            for m in CITATION_RE.finditer(content or ""):
                n = int(m.group(1))
                stats[n]["mentions"] += 1
                stats[n]["specs"].add(spec_id)
        return dict(stats), in_corpus
    finally:
        con.close()


def update_manifest(output_dir: Path, all_meta: dict[int, dict]) -> None:
    """Write/update data/rfcs/manifest.json with all RFC metadata."""
    manifest_path = output_dir / "manifest.json"
    existing: dict[str, dict] = {}
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except ValueError:
            existing = {}

    for rfc_number, meta in all_meta.items():
        existing[str(rfc_number)] = meta

    manifest_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nManifest updated: {manifest_path} ({len(existing)} RFCs)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Download RFCs from rfc-editor.org")
    parser.add_argument("--rfc", action="append", type=int, metavar="NUMBER",
                        help="RFC number to download (can be repeated)")
    parser.add_argument("--category", metavar="CAT",
                        help="Download all RFCs in this category (e.g. SIP, TLS)")
    parser.add_argument("--all", action="store_true",
                        help="Download all priority RFCs")
    parser.add_argument("--output", default="data/rfcs/",
                        help="Output directory (default: data/rfcs/)")
    parser.add_argument("--from-citations", action="store_true",
                        help="Download RFCs cited by non-RFC sections of --db that the corpus lacks")
    parser.add_argument("--db", default="data/corpus/3gpp.db", help="Corpus DB for --from-citations")
    parser.add_argument("--min-mentions", type=int, default=1,
                        help="--from-citations: keep RFCs cited at least N times (OR --min-specs)")
    parser.add_argument("--min-specs", type=int, default=None,
                        help="--from-citations: also keep RFCs cited by at least N distinct specs")
    parser.add_argument("--list-only", action="store_true",
                        help="Print the selected RFC list (TSV) without downloading")
    parser.add_argument("--sleep", type=float, default=0.2,
                        help="Pause between RFCs in seconds (default 0.2)")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine which RFCs to download
    to_download: list[int] = []
    if args.from_citations:
        stats, in_corpus = cited_rfcs(Path(args.db))
        missing = {n: v for n, v in stats.items() if n not in in_corpus}
        def keep(v):
            if v["mentions"] >= args.min_mentions:
                return True
            return args.min_specs is not None and len(v["specs"]) >= args.min_specs
        selected = sorted((n for n, v in missing.items() if keep(v)),
                          key=lambda n: (-missing[n]["mentions"], n))
        print(f"Cited RFCs: {len(stats)}; in corpus: {len(set(stats) & in_corpus)}; "
              f"missing: {len(missing)}; selected: {len(selected)}", file=sys.stderr)
        if args.list_only:
            print("rfc\tmentions\tspecs")
            for n in selected:
                print(f"{n}\t{missing[n]['mentions']}\t{len(missing[n]['specs'])}")
            return
        to_download = selected
        if not to_download:
            print("No missing RFCs selected; cited RFCs are already in the corpus or below the requested thresholds.")
            return
    elif args.all:
        to_download = sorted(PRIORITY_RFCS.keys())
    else:
        if args.rfc:
            to_download.extend(args.rfc)
        if args.category:
            cat = args.category.upper()
            for num, c in PRIORITY_RFCS.items():
                if c.upper() == cat:
                    to_download.append(num)
        to_download = sorted(set(to_download))

    if not to_download:
        parser.error("Specify --rfc, --category, --all or --from-citations")

    print(f"Downloading {len(to_download)} RFCs to {output_dir}/")
    all_meta: dict[int, dict] = {}

    failed: list[int] = []
    for rfc_number in to_download:
        meta = download_rfc(rfc_number, output_dir)
        if meta:
            all_meta[rfc_number] = meta
        else:
            failed.append(rfc_number)
        time.sleep(args.sleep)
    if failed:
        print(f"Not available: {' '.join(map(str, failed))}")

    update_manifest(output_dir, all_meta)
    print(f"\nDone. Downloaded {len(all_meta)}/{len(to_download)} RFCs.")


if __name__ == "__main__":
    main()
