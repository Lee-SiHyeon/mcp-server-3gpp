export function migrateImportantKwd(db) {
  const currentVersion = db.pragma('user_version', { simple: true });

  if (currentVersion < 3) {
    const cols = db.pragma('table_info(sections)');
    const hasImportantKwd = cols.some(
      (c) => c.name === 'important_kwd'
    );
    if (!hasImportantKwd) {
      db.exec(`ALTER TABLE sections ADD COLUMN important_kwd TEXT NOT NULL DEFAULT ''`);
    }
    const ftsInfo = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='sections_fts'"
    ).get();
    if (ftsInfo && !ftsInfo.sql.includes('important_kwd')) {
      db.exec(`
        INSERT INTO sections_fts(sections_fts) VALUES ('rebuild');
        DROP TABLE IF EXISTS sections_fts;
        CREATE VIRTUAL TABLE sections_fts USING fts5(
          section_title,
          important_kwd,
          content,
          content='sections',
          content_rowid='rowid'
        );
        INSERT INTO sections_fts(rowid, section_title, important_kwd, content)
          SELECT rowid, section_title, important_kwd, content FROM sections;
      `);
      db.exec(`
        DROP TRIGGER IF EXISTS sections_ai;
        DROP TRIGGER IF EXISTS sections_ad;
        DROP TRIGGER IF EXISTS sections_au;
        CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
          INSERT INTO sections_fts(rowid, section_title, important_kwd, content)
          VALUES (new.rowid, new.section_title, new.important_kwd, new.content);
        END;
        CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
          INSERT INTO sections_fts(sections_fts, rowid, section_title, important_kwd, content)
          VALUES ('delete', old.rowid, old.section_title, old.important_kwd, old.content);
        END;
        CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
          INSERT INTO sections_fts(sections_fts, rowid, section_title, important_kwd, content)
          VALUES ('delete', old.rowid, old.section_title, old.important_kwd, old.content);
          INSERT INTO sections_fts(rowid, section_title, important_kwd, content)
          VALUES (new.rowid, new.section_title, new.important_kwd, new.content);
        END;
      `);
    }
    db.pragma('user_version = 3');
  }
}
