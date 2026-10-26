"""Create a tiny synthetic corpus for the container build smoke test."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
target = root / "data" / "corpus" / "3gpp.db"
target.parent.mkdir(parents=True, exist_ok=True)
target.unlink(missing_ok=True)  # Replace only the disposable checkout's LFS pointer.
with sqlite3.connect(target) as db:
    db.executescript((root / "db" / "schema.sql").read_text(encoding="utf-8"))
    db.execute("INSERT INTO specs(id,title,version) VALUES(?,?,?)", ("ts_24_301", "Fixture", "v1"))
    content = "Synthetic fixture: attach reject handling."
    db.execute(
        "INSERT INTO sections(id,spec_id,section_number,section_title,content,content_length) VALUES(?,?,?,?,?,?)",
        ("ts_24_301:1", "ts_24_301", "1", "Attach reject", content, len(content)),
    )
