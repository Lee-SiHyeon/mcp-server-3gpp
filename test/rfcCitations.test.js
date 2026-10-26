import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('RFC acquisition and references agree on hyphens, spacing, case and padded numbers', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.homedir(), 'rfc-citations-'));
  const dbPath = path.join(dir, 'fixture.db');
  const db = new Database(dbPath);
  try {
    db.exec(`CREATE TABLE specs(id TEXT PRIMARY KEY);
      CREATE TABLE sections(id TEXT PRIMARY KEY, spec_id TEXT, content TEXT);
      INSERT INTO specs VALUES('ts_33_210'),('rfc_768'),('rfc_791');`);
    db.prepare('INSERT INTO sections VALUES(?,?,?)').run('ts_33_210:5.4.0', 'ts_33_210',
      'RFC-2451; RFC 0768; rfc0791; RFC  2451; RFC–2451; RFC 12345; RFC123456 is not an RFC number.');
    const args = ['scripts/download_rfc.py', '--from-citations', '--db', dbPath, '--output', dir];
    const acquisition = spawnSync('python3', [...args, '--list-only'], { cwd: root, encoding: 'utf8' });
    assert.equal(acquisition.status, 0, acquisition.stderr);
    assert.deepEqual(acquisition.stdout.trim().split('\n').slice(1).map(line => Number(line.split('\t')[0])).sort((a,b)=>a-b), [2451,12345]);
    const extraction = spawnSync(process.execPath, ['scripts/extract_cross_refs.js', '--db', dbPath], { cwd: root, encoding: 'utf8' });
    assert.equal(extraction.status, 0, extraction.stderr);
    assert.deepEqual(db.prepare('SELECT target_spec_id FROM spec_references ORDER BY target_spec_id').all().map(r=>r.target_spec_id),
      ['rfc_12345','rfc_2451','rfc_768','rfc_791']);
    assert.equal(db.prepare('SELECT sum(in_corpus) AS n FROM spec_references').get().n, 2);
    db.exec("INSERT INTO specs VALUES('rfc_2451'),('rfc_12345')");
    const repeat = spawnSync('python3', args, { cwd: root, encoding: 'utf8' });
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /already|No missing/i);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
