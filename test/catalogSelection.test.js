import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initDatabase } from '../src/db/schema.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-etsi-select-'));
const dbPath = path.join(tmpDir, 'select.db');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSelect(args = []) {
  return execFileSync('python3', ['scripts/select_etsi_ingest.py', '--db', dbPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

before(() => {
  const { db } = initDatabase(dbPath);
  db.exec(`
    INSERT INTO etsi_publication_types(id, source_url)
    VALUES ('etsi_ts', 'https://www.etsi.org/deliver/etsi_ts/');

    INSERT INTO etsi_ranges(publication_type, range_name, source_url)
    VALUES ('etsi_ts', '124500_124599', 'https://www.etsi.org/deliver/etsi_ts/124500_124599/');

    INSERT INTO etsi_documents(
      id, publication_type, etsi_number, range_name, source_url,
      mapped_3gpp_id, mapped_3gpp_spec, latest_version, version_count
    )
    VALUES
      (
        'etsi_ts_124501', 'etsi_ts', '124501', '124500_124599',
        'https://www.etsi.org/deliver/etsi_ts/124500_124599/124501/',
        'ts_24_501', 'TS 24.501', '18.09.00', 1
      ),
      (
        'etsi_ts_128999', 'etsi_ts', '128999', '124500_124599',
        'https://www.etsi.org/deliver/etsi_ts/128900_128999/128999/',
        'ts_28_999', 'TS 28.999', '18.00.00', 1
      );
  `);
  db.close();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ETSI ingest selection CLI', () => {
  test('priority policy selects priority 3GPP series only', () => {
    const output = runSelect(['--policy', 'priority', '--format', 'json']);
    const data = JSON.parse(output);

    assert.equal(data.documents.length, 1);
    assert.equal(data.documents[0].document_id, 'etsi_ts_124501');
  });

  test('apply marks selected rows and download-list emits downloader bridge data', () => {
    const output = runSelect(['--policy', 'priority', '--apply', '--format', 'download-list']);

    assert.match(output, /^ts\t24\.501\tetsi_ts_124501\t18\.09\.00\t0/m);

    const { db } = initDatabase(dbPath);
    const row = db.prepare(`
      SELECT selected_for_ingest, download_status, extract_status, embedding_status
      FROM etsi_document_status
      WHERE document_id = 'etsi_ts_124501'
    `).get();
    db.close();

    assert.equal(row.selected_for_ingest, 1);
    assert.equal(row.download_status, 'queued');
    assert.equal(row.extract_status, 'not_started');
    assert.equal(row.embedding_status, 'not_started');
  });
});
