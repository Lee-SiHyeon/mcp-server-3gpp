#!/usr/bin/env python3
"""Select cataloged ETSI documents for later download/extract/embed work.

This script only marks or reports catalog rows. It does not download PDFs,
extract content, or generate embeddings.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from common_paths import PROJECT_ROOT

DEFAULT_DB = PROJECT_ROOT / "data" / "corpus" / "3gpp.db"

STATUS_DDL = """
CREATE TABLE IF NOT EXISTS etsi_document_status (
  document_id TEXT PRIMARY KEY REFERENCES etsi_documents(id),
  selected_for_ingest INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT,
  download_status TEXT NOT NULL DEFAULT 'not_selected',
  extract_status TEXT NOT NULL DEFAULT 'not_selected',
  embedding_status TEXT NOT NULL DEFAULT 'not_selected',
  latest_cataloged_version_id INTEGER,
  downloaded_file_path TEXT,
  extracted_spec_id TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_etsi_doc_status_ingest
ON etsi_document_status(selected_for_ingest, download_status, extract_status, embedding_status);
"""

PRIORITY_SERIES = {"23", "24", "29", "31", "33", "34", "36", "38", "51"}
PRIORITY_EXACT = {
    "ts_24_008",
    "ts_24_229",
    "ts_24_301",
    "ts_24_501",
    "ts_31_102",
    "ts_31_121",
    "ts_31_124",
    "ts_34_123_1",
    "ts_34_229_1",
    "ts_34_229_5",
    "ts_36_331",
    "ts_36_523_1",
    "ts_38_300",
    "ts_38_331",
    "ts_38_523_1",
    "ts_51_010_1",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite DB path")
    parser.add_argument(
        "--policy",
        choices=["priority", "all-mapped"],
        default="priority",
        help="Selection policy to apply or preview",
    )
    parser.add_argument("--apply", action="store_true", help="Write selected_for_ingest markers")
    parser.add_argument("--limit", type=int, help="Limit selected rows")
    parser.add_argument(
        "--format",
        choices=["table", "json", "download-list"],
        default="table",
        help="Output format",
    )
    return parser.parse_args(argv)


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 5000")
    db.executescript(STATUS_DDL)
    return db


def selected_rows(db: sqlite3.Connection, policy: str, limit: int | None) -> list[sqlite3.Row]:
    rows = db.execute(
        """
        SELECT
          d.id,
          d.publication_type,
          d.etsi_number,
          d.mapped_3gpp_id,
          d.mapped_3gpp_spec,
          d.latest_version,
          d.latest_version_id,
          d.source_url,
          coalesce(file_counts.file_count, 0) AS file_count
        FROM etsi_documents d
        LEFT JOIN (
          SELECT document_id, count(*) AS file_count
          FROM etsi_files
          GROUP BY document_id
        ) file_counts ON file_counts.document_id = d.id
        WHERE d.publication_type IN ('etsi_ts', 'etsi_tr')
          AND d.mapped_3gpp_id IS NOT NULL
        ORDER BY d.publication_type, d.etsi_number
        """
    ).fetchall()

    if policy == "all-mapped":
        selected = rows
    else:
        selected = [row for row in rows if is_priority(row["mapped_3gpp_id"])]

    return selected[:limit] if limit is not None else selected


def is_priority(mapped_id: str) -> bool:
    if mapped_id in PRIORITY_EXACT:
        return True
    parts = mapped_id.split("_")
    return len(parts) >= 3 and parts[0] in {"ts", "tr"} and parts[1] in PRIORITY_SERIES


def apply_selection(db: sqlite3.Connection, rows: list[sqlite3.Row], policy: str) -> None:
    for row in rows:
        reason = selection_reason(row, policy)
        db.execute(
            """
            INSERT INTO etsi_document_status(
              document_id,
              selected_for_ingest,
              selection_reason,
              download_status,
              extract_status,
              embedding_status,
              latest_cataloged_version_id
            )
            VALUES (?, 1, ?, 'queued', 'not_started', 'not_started', ?)
            ON CONFLICT(document_id) DO UPDATE SET
              selected_for_ingest = 1,
              selection_reason = excluded.selection_reason,
              download_status = CASE
                WHEN etsi_document_status.download_status = 'not_selected' THEN 'queued'
                ELSE etsi_document_status.download_status
              END,
              extract_status = CASE
                WHEN etsi_document_status.extract_status = 'not_selected' THEN 'not_started'
                ELSE etsi_document_status.extract_status
              END,
              embedding_status = CASE
                WHEN etsi_document_status.embedding_status = 'not_selected' THEN 'not_started'
                ELSE etsi_document_status.embedding_status
              END,
              latest_cataloged_version_id = excluded.latest_cataloged_version_id,
              updated_at = datetime('now')
            """,
            (row["id"], reason, row["latest_version_id"]),
        )
    db.commit()


def selection_reason(row: sqlite3.Row, policy: str) -> str:
    mapped_id = row["mapped_3gpp_id"] or ""
    if mapped_id in PRIORITY_EXACT:
        return f"{policy}: explicit protocol/IMS/SIM/NAS/RRC priority"
    parts = mapped_id.split("_")
    if len(parts) >= 2 and parts[1] in PRIORITY_SERIES:
        return f"{policy}: priority 3GPP series {parts[1]}"
    return f"{policy}: 3GPP-mapped ETSI document"


def render(rows: list[sqlite3.Row], output_format: str) -> str:
    payload = [row_payload(row) for row in rows]
    if output_format == "json":
        return json.dumps({"documents": payload}, indent=2, ensure_ascii=False)
    if output_format == "download-list":
        return "\n".join(download_line(row) for row in payload)
    if not payload:
        return "No documents selected"
    lines = ["document_id\tmapped_3gpp_spec\tlatest_version\tfiles"]
    lines.extend(
        f"{row['document_id']}\t{row['mapped_3gpp_spec']}\t{row['latest_version'] or ''}\t{row['file_count']}"
        for row in payload
    )
    return "\n".join(lines)


def row_payload(row: sqlite3.Row) -> dict[str, object]:
    mapped_type, mapped_spec = split_mapped_spec(row["mapped_3gpp_spec"])
    return {
        "document_id": row["id"],
        "publication_type": row["publication_type"],
        "etsi_number": row["etsi_number"],
        "mapped_3gpp_id": row["mapped_3gpp_id"],
        "mapped_3gpp_spec": row["mapped_3gpp_spec"],
        "download_type": mapped_type,
        "download_spec": mapped_spec,
        "latest_version": row["latest_version"],
        "file_count": row["file_count"],
        "source_url": row["source_url"],
    }


def split_mapped_spec(mapped_spec: str | None) -> tuple[str, str]:
    if not mapped_spec:
        return "", ""
    parts = mapped_spec.split(maxsplit=1)
    if len(parts) != 2:
        return "", mapped_spec
    return parts[0].lower(), parts[1]


def download_line(row: dict[str, object]) -> str:
    return "\t".join(
        "" if row[key] is None else str(row[key])
        for key in ["download_type", "download_spec", "document_id", "latest_version", "file_count"]
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    db = connect(args.db)
    try:
        rows = selected_rows(db, args.policy, args.limit)
        if args.apply:
            apply_selection(db, rows, args.policy)
        print(render(rows, args.format))
        print(
            json.dumps(
                {"selected": len(rows), "applied": args.apply, "policy": args.policy},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
