/**
 * loadStructuredSections({ replaceExisting }) — a re-ingest must drop the
 * spec's stale sections/TOC/references and record the real section count.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { closeConnection, getConnection } from '../src/db/connection.js';
import { loadStructuredSections } from '../src/ingest/loadDatabase.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-load-replace-'));
const dbPath = path.join(tmpDir, 'corpus.db');
const interDir = path.join(tmpDir, 'intermediate');

function writeSpec(specId, version, sections) {
  fs.writeFileSync(path.join(interDir, `${specId}_structure.jsonl`), [
    JSON.stringify({ type: 'spec_meta', spec_id: specId, title: `Title ${version}`, version, total_pages: 3, source_pdf: `${specId}_${version}.pdf` }),
    ...sections.map((s, i) => JSON.stringify({ type: 'toc_entry', sort_order: i, level: s.number.split('.').length, title: `${s.number} ${s.title}`, page: 1, section_number: s.number })),
  ].join('\n'));
  fs.writeFileSync(path.join(interDir, `${specId}_sections.jsonl`), sections.map(s => JSON.stringify({
    section_id: `${specId}:${s.number}`, spec_id: specId, section_number: s.number, section_title: s.title,
    page_start: 1, page_end: 1, content: `${s.title} body`,
  })).join('\n'));
}

before(() => {
  fs.mkdirSync(interDir, { recursive: true });
  const { db } = initDatabase(dbPath);
  db.close();
});

after(() => {
  closeConnection();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadStructuredSections replaceExisting', () => {
  test('re-ingest removes stale sections and keeps letter-suffixed ids', () => {
    writeSpec('ts_36_523_1', 'v0.0.6', [
      { number: '6.1', title: 'Old' },
      { number: '99.9', title: 'Stale only in old version' },
    ]);
    loadStructuredSections(interDir, dbPath, { specFilter: 'ts_36_523_1' });
    const db = getConnection(dbPath);
    db.prepare("INSERT INTO spec_references(source_spec_id, target_spec_id, ref_type, section_id) VALUES ('ts_36_523_1', 'ts_24_301', '3gpp', 'ts_36_523_1:99.9')").run();

    writeSpec('ts_36_523_1', 'v19.4.0', [
      { number: '6.1', title: 'New' },
      { number: '6.1.2.3a', title: 'Letter suffix' },
      { number: '15.1A.1', title: 'Mid-id letter' },
    ]);
    loadStructuredSections(interDir, dbPath, { specFilter: 'ts_36_523_1', replaceExisting: true });

    const spec = db.prepare("SELECT version, source_pdf, total_sections FROM specs WHERE id = 'ts_36_523_1'").get();
    assert.equal(spec.version, 'v19.4.0');
    assert.equal(spec.source_pdf, 'ts_36_523_1_v19.4.0.pdf');
    assert.equal(spec.total_sections, 3);
    const nums = db.prepare("SELECT section_number FROM sections WHERE spec_id = 'ts_36_523_1' ORDER BY section_number").all().map(r => r.section_number);
    assert.deepEqual(nums, ['15.1A.1', '6.1', '6.1.2.3a']);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM toc WHERE spec_id = 'ts_36_523_1' AND section_number = '99.9'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM spec_references WHERE source_spec_id = 'ts_36_523_1'").get().c, 0);
    // FTS stays in sync with the delete/insert
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sections_fts WHERE sections_fts MATCH 'Stale'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sections_fts WHERE sections_fts MATCH 'suffix'").get().c, 1);
  });

  test('ETSI-only 3-digit series get an ETSI description', () => {
    writeSpec('ts_103_412', 'v1.3.1', [{ number: '7.1.1.2a', title: 'eCall CTP' }]);
    loadStructuredSections(interDir, dbPath, { specFilter: 'ts_103_412', replaceExisting: true });
    const row = getConnection(dbPath).prepare("SELECT series, description FROM specs WHERE id = 'ts_103_412'").get();
    assert.equal(row.series, '103');
    assert.equal(row.description, 'ETSI TS 103 412');
  });
});
