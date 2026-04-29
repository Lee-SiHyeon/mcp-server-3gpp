#!/usr/bin/env python3
"""Crawl the public ETSI delivery directory into the local SQLite catalog.

This script stores directory metadata only. It does not download PDFs or run
text extraction/embedding. Use --depth files when file-level URLs are needed.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import signal
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin
from urllib.request import Request, urlopen

_scripts_dir = Path(__file__).resolve().parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

from common_paths import PROJECT_ROOT

ETSI_BASE = "https://www.etsi.org/deliver/"
USER_AGENT = "Mozilla/5.0 (compatible; mcp-server-3gpp-catalog/1.0)"
DEFAULT_DB = PROJECT_ROOT / "data" / "corpus" / "3gpp.db"
DEPTHS = ("ranges", "documents", "versions", "files")

CATALOG_DDL = """
CREATE TABLE IF NOT EXISTS etsi_publication_types (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS etsi_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_type TEXT NOT NULL REFERENCES etsi_publication_types(id),
  range_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  directory_modified_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_type, range_name)
);

CREATE TABLE IF NOT EXISTS etsi_documents (
  id TEXT PRIMARY KEY,
  publication_type TEXT NOT NULL REFERENCES etsi_publication_types(id),
  etsi_number TEXT NOT NULL,
  range_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  mapped_3gpp_id TEXT,
  mapped_3gpp_spec TEXT,
  latest_version TEXT,
  latest_version_id INTEGER,
  version_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_type, etsi_number)
);

CREATE TABLE IF NOT EXISTS etsi_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES etsi_documents(id),
  version TEXT NOT NULL,
  suffix TEXT,
  source_url TEXT NOT NULL,
  directory_modified_at TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, version, suffix)
);

CREATE TABLE IF NOT EXISTS etsi_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES etsi_versions(id),
  document_id TEXT NOT NULL REFERENCES etsi_documents(id),
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  size_bytes INTEGER,
  modified_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, filename)
);

CREATE TABLE IF NOT EXISTS catalog_crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_hash TEXT,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  requests_made INTEGER NOT NULL DEFAULT 0,
  publication_types_seen INTEGER NOT NULL DEFAULT 0,
  ranges_seen INTEGER NOT NULL DEFAULT 0,
  documents_seen INTEGER NOT NULL DEFAULT 0,
  versions_seen INTEGER NOT NULL DEFAULT 0,
  files_seen INTEGER NOT NULL DEFAULT 0,
  warnings TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  heartbeat_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS catalog_crawl_progress (
  run_id INTEGER NOT NULL REFERENCES catalog_crawl_runs(id),
  unit_type TEXT NOT NULL,
  publication_type TEXT,
  range_name TEXT,
  document_id TEXT,
  version_id INTEGER,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(run_id, unit_type, publication_type, range_name, document_id, version_id)
);

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

CREATE INDEX IF NOT EXISTS idx_etsi_ranges_pub ON etsi_ranges(publication_type);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_pub_range ON etsi_documents(publication_type, range_name);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_mapped ON etsi_documents(mapped_3gpp_id);
CREATE INDEX IF NOT EXISTS idx_etsi_documents_latest ON etsi_documents(publication_type, latest_version);
CREATE INDEX IF NOT EXISTS idx_etsi_versions_document ON etsi_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_etsi_files_document ON etsi_files(document_id);
CREATE INDEX IF NOT EXISTS idx_etsi_files_version ON etsi_files(version_id);
"""

ENTRY_RE = re.compile(
    r"(?P<date>\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)?"
    r"\s*(?P<size><dir>|\d+)?\s*<a\s+href=\"(?P<href>[^\"]+)\">(?P<name>[^<]+)</a>",
    re.IGNORECASE,
)
VERSION_RE = re.compile(r"^(?P<version>\d{2}\.\d{2}\.\d{2})(?P<suffix>_[0-9A-Za-z]+)?/?$")
RANGE_RE = re.compile(r"^\d+_\d+$")


@dataclass(frozen=True)
class ListingEntry:
    name: str
    href: str
    url: str
    is_dir: bool
    modified_at: str | None
    size_bytes: int | None


class CrawlLimitReached(Exception):
    pass


class CrawlInterrupted(Exception):
    pass


class EtsiCatalogCrawler:
    def __init__(
        self,
        db: sqlite3.Connection,
        *,
        run_id: int | None,
        delay: float,
        max_requests: int | None,
        verbose: bool = True,
    ) -> None:
        self.db = db
        self.run_id = run_id
        self.delay = delay
        self.max_requests = max_requests
        self.verbose = verbose
        self.requests_made = 0
        self.counts = {
            "publication_types_seen": 0,
            "ranges_seen": 0,
            "documents_seen": 0,
            "versions_seen": 0,
            "files_seen": 0,
        }
        self.warnings: list[str] = []
        if run_id is not None:
            self.load_run_counts(run_id)

    def load_run_counts(self, run_id: int) -> None:
        row = self.db.execute(
            """
            SELECT requests_made, publication_types_seen, ranges_seen, documents_seen, versions_seen, files_seen
            FROM catalog_crawl_runs
            WHERE id = ?
            """,
            (run_id,),
        ).fetchone()
        if not row:
            return
        self.requests_made = int(row[0] or 0)
        for index, key in enumerate(self.counts.keys(), start=1):
            self.counts[key] = int(row[index] or 0)

    def fetch_listing(self, url: str) -> list[ListingEntry]:
        if self.max_requests is not None and self.requests_made >= self.max_requests:
            raise CrawlLimitReached(f"max request limit reached ({self.max_requests})")

        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8", errors="replace")

        self.requests_made += 1
        self.write_heartbeat()
        if self.delay > 0:
            time.sleep(self.delay)
        return parse_listing(body, url)

    def crawl(
        self,
        publication_types: list[str],
        *,
        depth: str,
        range_filter: set[str],
        range_prefix: str | None,
        max_ranges: int | None,
        max_docs: int | None,
        max_versions: int | None,
    ) -> None:
        depth_index = DEPTHS.index(depth)
        docs_seen = self.counts["documents_seen"]

        for publication_type in publication_types:
            pub_url = urljoin(ETSI_BASE, f"{publication_type}/")
            self.upsert_publication_type(publication_type, pub_url)
            self.counts["publication_types_seen"] += 1

            ranges = [entry for entry in self.fetch_listing(pub_url) if is_range_entry(entry)]
            if range_filter:
                ranges = [entry for entry in ranges if clean_name(entry.name) in range_filter]
            if range_prefix:
                ranges = [entry for entry in ranges if clean_name(entry.name).startswith(range_prefix)]
            if max_ranges is not None:
                ranges = ranges[:max_ranges]

            for range_entry in ranges:
                range_name = clean_name(range_entry.name)
                if self.is_range_completed(publication_type, range_name):
                    self.log(f"skip completed range {publication_type}/{range_name}")
                    continue
                self.mark_range(publication_type, range_name, "running")
                self.log(f"crawl range {publication_type}/{range_name}")

                self.upsert_range(publication_type, range_name, range_entry)
                self.counts["ranges_seen"] += 1
                if depth_index < DEPTHS.index("documents"):
                    self.mark_range(publication_type, range_name, "completed")
                    self.commit_checkpoint(publication_type, range_name)
                    continue

                doc_entries = [
                    entry for entry in self.fetch_listing(range_entry.url)
                    if entry.is_dir and clean_name(entry.name).isdigit()
                ]

                for doc_entry in doc_entries:
                    if max_docs is not None and docs_seen >= max_docs:
                        raise CrawlLimitReached(f"max document limit reached ({max_docs})")
                    docs_seen += 1

                    etsi_number = clean_name(doc_entry.name)
                    document_id = document_id_for(publication_type, etsi_number)
                    mapped_id, mapped_spec = map_3gpp(publication_type, etsi_number)
                    self.upsert_document(
                        document_id,
                        publication_type,
                        range_name,
                        etsi_number,
                        doc_entry,
                        mapped_id,
                        mapped_spec,
                    )
                    self.counts["documents_seen"] += 1
                    if depth_index < DEPTHS.index("versions"):
                        continue

                    version_entries = [
                        entry for entry in self.fetch_listing(doc_entry.url)
                        if entry.is_dir and VERSION_RE.match(clean_name(entry.name))
                    ]
                    version_entries.sort(
                        key=lambda entry: version_sort_key(clean_name(entry.name).split("_", 1)[0]),
                        reverse=True,
                    )
                    if max_versions is not None:
                        version_entries = version_entries[:max_versions]
                    version_rows: list[tuple[str, int]] = []

                    for version_entry in version_entries:
                        version_name = clean_name(version_entry.name)
                        version_id = self.upsert_version(document_id, version_name, version_entry)
                        version_rows.append((version_name.split("_", 1)[0], version_id))
                        self.counts["versions_seen"] += 1
                        if depth_index < DEPTHS.index("files"):
                            continue

                        file_entries = [entry for entry in self.fetch_listing(version_entry.url) if not entry.is_dir]
                        for file_entry in file_entries:
                            self.upsert_file(version_id, document_id, file_entry)
                            self.counts["files_seen"] += 1
                        self.update_version_file_count(version_id)

                    self.update_document_latest(document_id, version_rows)

                self.mark_range(publication_type, range_name, "completed")
                self.commit_checkpoint(publication_type, range_name)

    def log(self, message: str) -> None:
        if self.verbose:
            print(message, flush=True)

    def write_heartbeat(self) -> None:
        if self.run_id is None:
            return
        self.db.execute(
            """
            UPDATE catalog_crawl_runs
            SET requests_made = ?,
                publication_types_seen = ?,
                ranges_seen = ?,
                documents_seen = ?,
                versions_seen = ?,
                files_seen = ?,
                heartbeat_at = ?
            WHERE id = ?
            """,
            (
                self.requests_made,
                self.counts["publication_types_seen"],
                self.counts["ranges_seen"],
                self.counts["documents_seen"],
                self.counts["versions_seen"],
                self.counts["files_seen"],
                utc_now(),
                self.run_id,
            ),
        )

    def mark_range(self, publication_type: str, range_name: str, status: str) -> None:
        if self.run_id is None:
            return
        self.db.execute(
            """
            INSERT INTO catalog_crawl_progress(
              run_id, unit_type, publication_type, range_name, document_id, version_id, status
            )
            VALUES (?, 'range', ?, ?, '', 0, ?)
            ON CONFLICT(run_id, unit_type, publication_type, range_name, document_id, version_id)
            DO UPDATE SET status = excluded.status, updated_at = datetime('now')
            """,
            (self.run_id, publication_type, range_name, status),
        )

    def is_range_completed(self, publication_type: str, range_name: str) -> bool:
        if self.run_id is None:
            return False
        row = self.db.execute(
            """
            SELECT status FROM catalog_crawl_progress
            WHERE run_id = ?
              AND unit_type = 'range'
              AND publication_type = ?
              AND range_name = ?
              AND document_id = ''
              AND version_id = 0
            """,
            (self.run_id, publication_type, range_name),
        ).fetchone()
        return bool(row and row[0] == "completed")

    def commit_checkpoint(self, publication_type: str, range_name: str) -> None:
        if self.run_id is None:
            self.db.commit()
            return
        checkpoint = {
            "publication_type": publication_type,
            "range_name": range_name,
            "updated_at": utc_now(),
        }
        self.db.execute(
            """
            UPDATE catalog_crawl_runs
            SET checkpoint_json = ?,
                requests_made = ?,
                publication_types_seen = ?,
                ranges_seen = ?,
                documents_seen = ?,
                versions_seen = ?,
                files_seen = ?,
                heartbeat_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(checkpoint, ensure_ascii=False),
                self.requests_made,
                self.counts["publication_types_seen"],
                self.counts["ranges_seen"],
                self.counts["documents_seen"],
                self.counts["versions_seen"],
                self.counts["files_seen"],
                utc_now(),
                self.run_id,
            ),
        )
        self.db.commit()

    def upsert_publication_type(self, publication_type: str, source_url: str) -> None:
        self.db.execute(
            """
            INSERT INTO etsi_publication_types(id, source_url)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET
              source_url = excluded.source_url,
              last_seen_at = datetime('now')
            """,
            (publication_type, source_url),
        )

    def upsert_range(self, publication_type: str, range_name: str, entry: ListingEntry) -> None:
        self.db.execute(
            """
            INSERT INTO etsi_ranges(publication_type, range_name, source_url, directory_modified_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(publication_type, range_name) DO UPDATE SET
              source_url = excluded.source_url,
              directory_modified_at = excluded.directory_modified_at,
              last_seen_at = datetime('now')
            """,
            (publication_type, range_name, entry.url, entry.modified_at),
        )

    def upsert_document(
        self,
        document_id: str,
        publication_type: str,
        range_name: str,
        etsi_number: str,
        entry: ListingEntry,
        mapped_id: str | None,
        mapped_spec: str | None,
    ) -> None:
        self.db.execute(
            """
            INSERT INTO etsi_documents(
              id, publication_type, etsi_number, range_name, source_url,
              mapped_3gpp_id, mapped_3gpp_spec
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(publication_type, etsi_number) DO UPDATE SET
              range_name = excluded.range_name,
              source_url = excluded.source_url,
              mapped_3gpp_id = excluded.mapped_3gpp_id,
              mapped_3gpp_spec = excluded.mapped_3gpp_spec,
              last_seen_at = datetime('now')
            """,
            (document_id, publication_type, etsi_number, range_name, entry.url, mapped_id, mapped_spec),
        )
        self.db.execute(
            """
            INSERT INTO etsi_document_status(document_id)
            VALUES (?)
            ON CONFLICT(document_id) DO UPDATE SET updated_at = etsi_document_status.updated_at
            """,
            (document_id,),
        )

    def upsert_version(self, document_id: str, version_name: str, entry: ListingEntry) -> int:
        match = VERSION_RE.match(version_name)
        if not match:
            raise ValueError(f"invalid ETSI version directory: {version_name}")
        version = match.group("version")
        suffix = match.group("suffix") or ""

        self.db.execute(
            """
            INSERT INTO etsi_versions(document_id, version, suffix, source_url, directory_modified_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(document_id, version, suffix) DO UPDATE SET
              source_url = excluded.source_url,
              directory_modified_at = excluded.directory_modified_at,
              last_seen_at = datetime('now')
            """,
            (document_id, version, suffix, entry.url, entry.modified_at),
        )
        row = self.db.execute(
            "SELECT id FROM etsi_versions WHERE document_id = ? AND version = ? AND suffix IS ?",
            (document_id, version, suffix),
        ).fetchone()
        return int(row[0])

    def upsert_file(self, version_id: int, document_id: str, entry: ListingEntry) -> None:
        file_type = Path(entry.name).suffix.lower().lstrip(".") or None
        self.db.execute(
            """
            INSERT INTO etsi_files(version_id, document_id, filename, file_url, file_type, size_bytes, modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(version_id, filename) DO UPDATE SET
              file_url = excluded.file_url,
              file_type = excluded.file_type,
              size_bytes = excluded.size_bytes,
              modified_at = excluded.modified_at,
              last_seen_at = datetime('now')
            """,
            (version_id, document_id, entry.name, entry.url, file_type, entry.size_bytes, entry.modified_at),
        )

    def update_version_file_count(self, version_id: int) -> None:
        self.db.execute(
            """
            UPDATE etsi_versions
            SET file_count = (
              SELECT count(*) FROM etsi_files WHERE version_id = ?
            )
            WHERE id = ?
            """,
            (version_id, version_id),
        )

    def update_document_latest(self, document_id: str, version_rows: list[tuple[str, int]]) -> None:
        if version_rows:
            latest_version, latest_id = max(version_rows, key=lambda row: version_sort_key(row[0]))
        else:
            latest_version = None
            latest_id = None
        self.db.execute(
            """
            UPDATE etsi_documents
            SET latest_version = ?,
                latest_version_id = ?,
                version_count = (
                  SELECT count(*) FROM etsi_versions WHERE document_id = ?
                ),
                last_seen_at = datetime('now')
            WHERE id = ?
            """,
            (latest_version, latest_id, document_id, document_id),
        )
        if latest_id is not None:
            self.db.execute(
                """
                INSERT INTO etsi_document_status(document_id, latest_cataloged_version_id)
                VALUES (?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                  latest_cataloged_version_id = excluded.latest_cataloged_version_id,
                  updated_at = datetime('now')
                """,
                (document_id, latest_id),
            )


def parse_listing(body: str, base_url: str) -> list[ListingEntry]:
    entries: list[ListingEntry] = []
    for match in ENTRY_RE.finditer(body):
        name = html.unescape(match.group("name")).strip()
        href = html.unescape(match.group("href")).strip()
        if not name or name.startswith("[") or href.startswith("?"):
            continue

        size_token = match.group("size")
        is_dir = href.endswith("/") or (size_token or "").lower() == "<dir>"
        size_bytes = None
        if size_token and size_token.isdigit():
            size_bytes = int(size_token)

        entries.append(
            ListingEntry(
                name=clean_name(name),
                href=href,
                url=urljoin(base_url, href),
                is_dir=is_dir,
                modified_at=match.group("date"),
                size_bytes=size_bytes,
            )
        )
    return entries


def clean_name(name: str) -> str:
    return name.strip().strip("/")


def is_range_entry(entry: ListingEntry) -> bool:
    name = clean_name(entry.name)
    if not entry.is_dir:
        return False
    if name.startswith("etsi_") or name == "deliver":
        return False
    return bool(RANGE_RE.match(name) or re.match(r"^[A-Za-z][A-Za-z0-9_-]*$", name))


def document_id_for(publication_type: str, etsi_number: str) -> str:
    return f"{publication_type}_{etsi_number}".lower()


def map_3gpp(publication_type: str, etsi_number: str) -> tuple[str | None, str | None]:
    prefix = publication_type.removeprefix("etsi_")
    if prefix not in {"ts", "tr"} or not etsi_number.isdigit():
        return None, None

    base = etsi_number[:6] if len(etsi_number) >= 8 else etsi_number
    if len(base) != 6:
        return None, None

    numeric = int(base)
    if numeric < 100000:
        return None, None

    relative = numeric - 100000
    series = relative // 1000
    doc = relative % 1000
    if series < 0 or doc < 0:
        return None, None

    mapped_id = f"{prefix}_{series:02d}_{doc:03d}"
    mapped_spec = f"{prefix.upper()} {series:02d}.{doc:03d}"
    if len(etsi_number) >= 8:
        subpart = int(etsi_number[6:])
        mapped_id = f"{mapped_id}_{subpart}"
        mapped_spec = f"{mapped_spec}-{subpart}"
    return mapped_id, mapped_spec


def version_sort_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def normalize_publication_types(values: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        for item in value.split(","):
            item = item.strip().lower()
            if not item:
                continue
            if not item.startswith("etsi_"):
                item = f"etsi_{item}"
            normalized.append(item)
    return sorted(set(normalized))


def discover_publication_types(crawler: EtsiCatalogCrawler) -> list[str]:
    return sorted(
        entry.name
        for entry in crawler.fetch_listing(ETSI_BASE)
        if entry.is_dir and entry.name.startswith("etsi_")
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA busy_timeout = 5000")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(CATALOG_DDL)
    ensure_catalog_migrations(db)
    return db


def ensure_catalog_migrations(db: sqlite3.Connection) -> None:
    ensure_columns(
        db,
        "catalog_crawl_runs",
        {
            "scope_hash": "TEXT",
            "checkpoint_json": "TEXT",
            "heartbeat_at": "TEXT",
        },
    )
    db.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_catalog_runs_scope ON catalog_crawl_runs(source, scope_hash, status);
        CREATE INDEX IF NOT EXISTS idx_catalog_progress_run_status ON catalog_crawl_progress(run_id, unit_type, status);
        CREATE INDEX IF NOT EXISTS idx_etsi_doc_status_ingest ON etsi_document_status(selected_for_ingest, download_status, extract_status, embedding_status);
        """
    )


def ensure_columns(db: sqlite3.Connection, table_name: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in db.execute(f"PRAGMA table_info({table_name})")}
    for column_name, definition in columns.items():
        if column_name not in existing:
            db.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
    db.commit()


def stable_scope_hash(scope: dict[str, object]) -> str:
    payload = json.dumps(scope, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_run(db: sqlite3.Connection, *, scope: str, scope_hash: str, depth: str) -> int:
    cur = db.execute(
        """
        INSERT INTO catalog_crawl_runs(source, scope, scope_hash, depth, status, heartbeat_at)
        VALUES ('etsi_deliver', ?, ?, ?, 'running', ?)
        """,
        (scope, scope_hash, depth, utc_now()),
    )
    db.commit()
    return int(cur.lastrowid)


def find_resume_run(db: sqlite3.Connection, *, scope_hash: str, depth: str) -> int | None:
    row = db.execute(
        """
        SELECT id
        FROM catalog_crawl_runs
        WHERE source = 'etsi_deliver'
          AND scope_hash = ?
          AND depth = ?
          AND status IN ('running', 'interrupted', 'limited', 'failed')
        ORDER BY id DESC
        LIMIT 1
        """,
        (scope_hash, depth),
    ).fetchone()
    return int(row[0]) if row else None


def resume_run(db: sqlite3.Connection, run_id: int) -> None:
    db.execute(
        """
        UPDATE catalog_crawl_runs
        SET status = 'running',
            heartbeat_at = ?,
            completed_at = NULL
        WHERE id = ?
        """,
        (utc_now(), run_id),
    )
    db.commit()


def finish_run(db: sqlite3.Connection, run_id: int, crawler: EtsiCatalogCrawler, status: str) -> None:
    if status != "completed":
        db.execute(
            """
            UPDATE catalog_crawl_progress
            SET status = ?, updated_at = datetime('now')
            WHERE run_id = ? AND status = 'running'
            """,
            (status, run_id),
        )
    db.execute(
        """
        UPDATE catalog_crawl_runs
        SET status = ?,
            requests_made = ?,
            publication_types_seen = ?,
            ranges_seen = ?,
            documents_seen = ?,
            versions_seen = ?,
            files_seen = ?,
            warnings = ?,
            heartbeat_at = ?,
            completed_at = ?
        WHERE id = ?
        """,
        (
            status,
            crawler.requests_made,
            crawler.counts["publication_types_seen"],
            crawler.counts["ranges_seen"],
            crawler.counts["documents_seen"],
            crawler.counts["versions_seen"],
            crawler.counts["files_seen"],
            json.dumps(crawler.warnings, ensure_ascii=False),
            utc_now(),
            utc_now(),
            run_id,
        ),
    )
    db.commit()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite DB path")
    parser.add_argument(
        "--publication-types",
        nargs="+",
        default=["etsi_ts", "etsi_tr"],
        help="Publication types to crawl, e.g. etsi_ts etsi_tr or ts,tr",
    )
    parser.add_argument(
        "--all-publication-types",
        action="store_true",
        help="Discover and crawl all etsi_* publication type directories under /deliver/",
    )
    parser.add_argument("--range", action="append", default=[], help="Exact range/group directory to crawl")
    parser.add_argument("--range-prefix", help="Only crawl range/group names with this prefix")
    parser.add_argument("--depth", choices=DEPTHS, default="versions")
    parser.add_argument("--max-ranges", type=int, help="Safety limit for range directories per publication type")
    parser.add_argument("--max-docs", type=int, help="Safety limit for documents across the run")
    parser.add_argument("--max-versions", type=int, help="Safety limit for versions per document")
    parser.add_argument("--max-requests", type=int, help="Safety limit for HTTP listing requests")
    parser.add_argument("--delay", type=float, default=0.1, help="Delay between HTTP requests in seconds")
    parser.add_argument("--resume", action="store_true", help="Resume the latest unfinished run with the same scope")
    parser.add_argument("--plan-only", action="store_true", help="Print the crawl scope summary without creating a crawl run")
    parser.add_argument("--list-publication-types", action="store_true", help="List etsi_* publication type directories and exit")
    parser.add_argument("--list-ranges", action="store_true", help="List selected range/group directories and exit")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-range progress logs")
    return parser.parse_args(argv)


def install_signal_handlers() -> None:
    def _raise_interrupted(signum, frame):  # noqa: ARG001
        raise CrawlInterrupted("interrupted by signal")

    signal.signal(signal.SIGINT, _raise_interrupted)
    signal.signal(signal.SIGTERM, _raise_interrupted)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    install_signal_handlers()
    db = open_db(args.db)
    discovery_crawler = EtsiCatalogCrawler(
        db,
        run_id=None,
        delay=args.delay,
        max_requests=args.max_requests,
        verbose=not args.quiet,
    )

    if args.all_publication_types:
        publication_types = discover_publication_types(discovery_crawler)
    else:
        publication_types = normalize_publication_types(args.publication_types)

    if args.list_publication_types:
        for publication_type in publication_types:
            print(publication_type)
        db.close()
        return 0

    if args.plan_only or args.list_ranges:
        ranges_by_type = collect_scope_ranges(
            discovery_crawler,
            publication_types,
            range_filter=set(args.range),
            range_prefix=args.range_prefix,
            max_ranges=args.max_ranges,
        )
        if args.list_ranges:
            for publication_type, range_names in ranges_by_type.items():
                for range_name in range_names:
                    print(f"{publication_type}/{range_name}")
        else:
            total_ranges = sum(len(range_names) for range_names in ranges_by_type.values())
            print("ETSI catalog crawl plan")
            print(f"  DB: {args.db}")
            print(f"  Depth: {args.depth}")
            print(f"  Publication types: {len(publication_types)}")
            print(f"  Ranges/groups: {total_ranges}")
            print(f"  Max docs: {args.max_docs if args.max_docs is not None else 'unlimited'}")
            print(f"  Max versions per doc: {args.max_versions if args.max_versions is not None else 'unlimited'}")
            print(f"  Requests made for planning: {discovery_crawler.requests_made}")
        db.close()
        return 0

    scope = {
        "publication_types": publication_types,
        "range": args.range,
        "range_prefix": args.range_prefix,
        "depth": args.depth,
        "max_ranges": args.max_ranges,
        "max_docs": args.max_docs,
        "max_versions": args.max_versions,
    }
    scope_json = json.dumps(scope, sort_keys=True, ensure_ascii=False)
    scope_hash = stable_scope_hash(scope)
    run_id = find_resume_run(db, scope_hash=scope_hash, depth=args.depth) if args.resume else None
    if run_id is not None:
        resume_run(db, run_id)
        print(f"Resuming ETSI catalog crawl run {run_id}")
    else:
        run_id = create_run(db, scope=scope_json, scope_hash=scope_hash, depth=args.depth)

    crawler = EtsiCatalogCrawler(
        db,
        run_id=run_id,
        delay=args.delay,
        max_requests=args.max_requests,
        verbose=not args.quiet,
    )

    try:
        crawler.crawl(
            publication_types,
            depth=args.depth,
            range_filter=set(args.range),
            range_prefix=args.range_prefix,
            max_ranges=args.max_ranges,
            max_docs=args.max_docs,
            max_versions=args.max_versions,
        )
        finish_run(db, run_id, crawler, "completed")
    except CrawlLimitReached as exc:
        crawler.warnings.append(str(exc))
        finish_run(db, run_id, crawler, "limited")
    except (KeyboardInterrupt, CrawlInterrupted) as exc:
        crawler.warnings.append(str(exc))
        finish_run(db, run_id, crawler, "interrupted")
    except Exception as exc:
        crawler.warnings.append(str(exc))
        finish_run(db, run_id, crawler, "failed")
        raise
    finally:
        db.close()

    print("ETSI catalog crawl complete")
    print(f"  DB: {args.db}")
    print(f"  Status: {db_status_for(args.db, run_id)}")
    print(f"  Requests: {crawler.requests_made}")
    for key, value in crawler.counts.items():
        print(f"  {key}: {value}")
    if crawler.warnings:
        print("  Warnings:")
        for warning in crawler.warnings:
            print(f"    - {warning}")
    return 0


def collect_scope_ranges(
    crawler: EtsiCatalogCrawler,
    publication_types: list[str],
    *,
    range_filter: set[str],
    range_prefix: str | None,
    max_ranges: int | None,
) -> dict[str, list[str]]:
    ranges_by_type: dict[str, list[str]] = {}
    for publication_type in publication_types:
        pub_url = urljoin(ETSI_BASE, f"{publication_type}/")
        ranges = [entry for entry in crawler.fetch_listing(pub_url) if is_range_entry(entry)]
        if range_filter:
            ranges = [entry for entry in ranges if clean_name(entry.name) in range_filter]
        if range_prefix:
            ranges = [entry for entry in ranges if clean_name(entry.name).startswith(range_prefix)]
        if max_ranges is not None:
            ranges = ranges[:max_ranges]
        ranges_by_type[publication_type] = [clean_name(entry.name) for entry in ranges]
    return ranges_by_type


def db_status_for(db_path: Path, run_id: int) -> str:
    db = sqlite3.connect(db_path)
    try:
        row = db.execute("SELECT status FROM catalog_crawl_runs WHERE id = ?", (run_id,)).fetchone()
        return row[0] if row else "unknown"
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
