#!/usr/bin/env python3
"""Download RFCs from rfc-editor.org and fetch metadata from IETF Datatracker API.

Usage:
    python scripts/download_rfc.py --rfc 3261
    python scripts/download_rfc.py --rfc 3261 --rfc 6733
    python scripts/download_rfc.py --category SIP
    python scripts/download_rfc.py --all
    python scripts/download_rfc.py --all --output data/rfcs/
"""
from __future__ import annotations

import argparse
import json
import sys
import time
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


def _get_with_retry(url: str, timeout: int = 30) -> requests.Response | None:
    """GET a URL, retry once on 503, return None on 404 or repeated failure."""
    for attempt in range(2):
        try:
            resp = SESSION.get(url, timeout=timeout)
            if resp.status_code == 404:
                return None
            if resp.status_code == 503:
                if attempt == 0:
                    print(f"  503 from {url}, retrying in 5s…")
                    time.sleep(5)
                    continue
                return None
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            if attempt == 0:
                print(f"  Request error: {exc}, retrying…")
                time.sleep(3)
                continue
            print(f"  Failed after retry: {exc}")
            return None
    return None


def fetch_metadata(rfc_number: int) -> dict:
    """Fetch RFC metadata from IETF Datatracker API."""
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

    # Download TXT
    if not txt_path.exists():
        resp = _get_with_retry(txt_url)
        if resp is None:
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
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine which RFCs to download
    to_download: list[int] = []
    if args.all:
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
        parser.error("Specify --rfc, --category, or --all")

    print(f"Downloading {len(to_download)} RFCs to {output_dir}/")
    all_meta: dict[int, dict] = {}

    for rfc_number in to_download:
        meta = download_rfc(rfc_number, output_dir)
        if meta:
            all_meta[rfc_number] = meta

    update_manifest(output_dir, all_meta)
    print(f"\nDone. Downloaded {len(all_meta)}/{len(to_download)} RFCs.")


if __name__ == "__main__":
    main()
