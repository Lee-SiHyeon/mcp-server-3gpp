import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { getConnection, closeConnection } from '../src/db/connection.js';
import { getCitationSourcesBySectionIds } from '../src/citations/metadata.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-citations-'));
const dbPath = path.join(tmpDir, 'citations.db');

before(() => {
  const { db } = initDatabase(dbPath);
  db.exec(`
    INSERT INTO specs(id, title, version, series, total_sections)
    VALUES
      ('ts_38_331', 'NR; Radio Resource Control protocol', 'v18.3.0', '38', 2),
      ('tr_23_501', 'System architecture for the 5G System', NULL, '23', 1);

    INSERT INTO sections(id, spec_id, section_number, section_title, page_start, page_end, content, content_length)
    VALUES
      ('ts_38_331:5.3.2', 'ts_38_331', '5.3.2', 'RRC connection establishment', 42, 44, 'body', 4),
      ('tr_23_501:4.2', 'tr_23_501', '4.2', 'Architecture reference model', 7, 9, 'body', 4);

    INSERT INTO etsi_publication_types(id, source_url)
    VALUES ('etsi_tr', 'https://www.etsi.org/deliver/etsi_tr/');

    INSERT INTO etsi_ranges(publication_type, range_name, source_url)
    VALUES ('etsi_tr', '123500_123599', 'https://www.etsi.org/deliver/etsi_tr/123500_123599/');

    INSERT INTO etsi_documents(
      id, publication_type, etsi_number, range_name, source_url,
      mapped_3gpp_id, mapped_3gpp_spec, latest_version, version_count
    )
    VALUES (
      'etsi_tr_123501', 'etsi_tr', '123501', '123500_123599',
      'https://www.etsi.org/deliver/etsi_tr/123500_123599/123501/',
      'tr_23_501', 'TR 23.501', '19.1.0', 1
    );
  `);
  db.close();
  getConnection(dbPath);
});

after(() => {
  closeConnection();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getCitationSourcesBySectionIds', () => {
  test('returns normalized citation metadata using specs.version first', () => {
    const sources = getCitationSourcesBySectionIds(['ts_38_331:5.3.2']);

    assert.deepEqual(sources, [{
      section_id: 'ts_38_331:5.3.2',
      spec_id: 'ts_38_331',
      doc_type: 'TS',
      doc_number: '38.331',
      spec_title: 'NR; Radio Resource Control protocol',
      spec_version: 'v18.3.0',
      section_number: '5.3.2',
      section_title: 'RRC connection establishment',
      page_start: 42,
      page_end: 44,
      source_id: 'ts_38_331:5.3.2',
    }]);
  });

  test('falls back to catalog latest_version and leaves missing ids absent', () => {
    const sources = getCitationSourcesBySectionIds(['missing:1', 'tr_23_501:4.2']);

    assert.equal(sources.length, 1);
    assert.equal(sources[0].section_id, 'tr_23_501:4.2');
    assert.equal(sources[0].spec_version, '19.1.0');
    assert.equal(sources[0].doc_type, 'TR');
    assert.equal(sources[0].doc_number, '23.501');
  });

  test('returns empty array for empty input without querying invalid SQL', () => {
    assert.deepEqual(getCitationSourcesBySectionIds([]), []);
  });
});
