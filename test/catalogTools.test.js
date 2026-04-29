import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { getConnection, closeConnection } from '../src/db/connection.js';
import { handleSearchEtsiCatalog } from '../src/tools/searchEtsiCatalog.js';
import { handleGetEtsiDocument } from '../src/tools/getEtsiDocument.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-etsi-catalog-'));
const dbPath = path.join(tmpDir, 'catalog.db');

async function parseResult(responseOrPromise) {
  const response = await Promise.resolve(responseOrPromise);
  assert.ok(response.content?.length > 0);
  assert.strictEqual(response.content[0].type, 'text');
  return JSON.parse(response.content[0].text);
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
    VALUES (
      'etsi_ts_124501', 'etsi_ts', '124501', '124500_124599',
      'https://www.etsi.org/deliver/etsi_ts/124500_124599/124501/',
      'ts_24_501', 'TS 24.501', '18.09.00', 1
    );

    INSERT INTO etsi_versions(document_id, version, suffix, source_url, file_count)
    VALUES (
      'etsi_ts_124501', '18.09.00', '_60',
      'https://www.etsi.org/deliver/etsi_ts/124500_124599/124501/18.09.00_60/',
      1
    );

    INSERT INTO etsi_files(version_id, document_id, filename, file_url, file_type, size_bytes)
    VALUES (
      last_insert_rowid(), 'etsi_ts_124501', 'ts_124501v180900p.pdf',
      'https://www.etsi.org/deliver/etsi_ts/124500_124599/124501/18.09.00_60/ts_124501v180900p.pdf',
      'pdf', 1234
    );

    INSERT INTO etsi_document_status(
      document_id, selected_for_ingest, selection_reason, download_status, extract_status, embedding_status
    )
    VALUES ('etsi_ts_124501', 1, 'priority NAS spec', 'queued', 'not_started', 'not_started');

    INSERT INTO specs(id, title, version, series, total_sections)
    VALUES ('ts_24_501', 'NAS protocol for 5GS', 'v18.9.0', '24', 10);
  `);
  db.close();
  getConnection(dbPath);
});

after(() => {
  closeConnection();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ETSI catalog tools', () => {
  test('search_etsi_catalog returns mapped catalog documents', async () => {
    const data = await parseResult(handleSearchEtsiCatalog({ mapped3gppSpec: 'TS 24.501' }));
    assert.equal(data.documents.length, 1);
    assert.equal(data.documents[0].id, 'etsi_ts_124501');
    assert.equal(data.documents[0].ingested_spec_id, 'ts_24_501');
    assert.equal(data.documents[0].selected_for_ingest, 1);
    assert.equal(data.documents[0].download_status, 'queued');
    assert.equal(data.status.counts.documents, 1);
  });

  test('search_etsi_catalog filters by file and ingest status', async () => {
    const data = await parseResult(handleSearchEtsiCatalog({
      hasFiles: true,
      selectedForIngest: true,
      ingestStatus: 'queued',
    }));

    assert.equal(data.documents.length, 1);
    assert.equal(data.documents[0].file_count, 1);
    assert.equal(data.documents[0].selection_reason, 'priority NAS spec');
  });

  test('get_etsi_document returns versions and files', async () => {
    const data = await parseResult(handleGetEtsiDocument({
      documentId: 'etsi_ts_124501',
      includeFiles: true,
    }));

    assert.equal(data.document.mapped_3gpp_id, 'ts_24_501');
    assert.equal(data.document.download_status, 'queued');
    assert.equal(data.versions.length, 1);
    assert.equal(data.versions[0].files.length, 1);
    assert.equal(data.versions[0].files[0].file_type, 'pdf');
  });
});
