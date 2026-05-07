import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { getConnection, closeConnection } from '../src/db/connection.js';
import { handleGenerateCitation } from '../src/tools/generateCitation.js';
import { handleSearch3gppDocs } from '../src/tools/search3gppDocs.js';
import { validateArgs } from '../src/tools/validateArgs.js';
import { registerTool, getToolList, tools } from '../src/tools/registry.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-citation-tool-'));
const dbPath = path.join(tmpDir, 'tool.db');

async function parseResult(responseOrPromise) {
  const response = await Promise.resolve(responseOrPromise);
  assert.ok(response.content?.length > 0);
  assert.strictEqual(response.content[0].type, 'text');
  return { response, data: JSON.parse(response.content[0].text) };
}

before(() => {
  const { db } = initDatabase(dbPath);
  db.exec(`
    INSERT INTO specs(id, title, version, series, total_sections)
    VALUES ('ts_38_331', 'NR; Radio Resource Control protocol', 'v18.3.0', '38', 2);

    INSERT INTO sections(id, spec_id, section_number, section_title, page_start, page_end, content, content_length, important_kwd)
    VALUES
      ('ts_38_331:5.3.2', 'ts_38_331', '5.3.2', 'RRC connection establishment', 42, 44, 'RRC connection establishment procedure', 38, 'RRC connection establishment'),
      ('ts_38_331:5.3.3', 'ts_38_331', '5.3.3', 'RRC connection reconfiguration', 45, 46, 'RRC connection reconfiguration procedure', 40, 'RRC connection reconfiguration');
  `);
  db.close();
  getConnection(dbPath);
});

after(() => {
  closeConnection();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generate_citation tool', () => {
  test('generates citations in input order and reports missing sections', async () => {
    const { response, data } = await parseResult(handleGenerateCitation({
      section_ids: ['missing:1', 'ts_38_331:5.3.2'],
      style: 'ieee',
    }));

    assert.deepEqual(response.structuredContent, data);
    assert.deepEqual(data.missing_section_ids, ['missing:1']);
    assert.deepEqual(data.citations.map(citation => citation.section_id), ['ts_38_331:5.3.2']);
    assert.equal(data.citations[0].style, 'ieee');
    assert.equal(
      data.citations[0].citation,
      '[1] 3GPP, "RRC connection establishment," 3GPP TS 38.331, sec. 5.3.2, version 18.3.0.',
    );
    assert.deepEqual(data.sources, [{
      source_id: 'ts_38_331:5.3.2',
      section_id: 'ts_38_331:5.3.2',
      spec_id: 'ts_38_331',
      section_number: '5.3.2',
      section_title: 'RRC connection establishment',
    }]);
  });

  test('validation rejects empty section_ids', () => {
    const validation = validateArgs('generate_citation', { section_ids: [] });

    assert.equal(validation.valid, false);
    assert.equal(validation.error.error, 'validation_error');
    assert.equal(validation.error.details[0].field, 'section_ids');
  });

  test('registry includes outputSchema and annotations pass-through', () => {
    tools.clear();
    registerTool('example', {
      name: 'example',
      description: 'Example tool',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      annotations: { readOnlyHint: true },
    }, () => ({}));

    assert.deepEqual(getToolList(), [{
      name: 'example',
      description: 'Example tool',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      annotations: { readOnlyHint: true },
    }]);
  });
});

describe('search_3gpp_docs citation enrichment', () => {
  test('adds citations to search results when requested', async () => {
    const { data } = await parseResult(handleSearch3gppDocs({
      query: 'RRC connection establishment',
      spec: 'ts_38_331',
      mode: 'keyword',
      maxResults: 1,
      includeCitations: true,
      citationStyle: 'plain',
    }));

    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].section_id, 'ts_38_331:5.3.2');
    assert.equal(
      data.results[0].citation,
      '3GPP TS 38.331 v18.3.0 - Section 5.3.2 - RRC connection establishment',
    );
    assert.equal(data.results[0].citation_style, 'plain');
    assert.equal(data.results[0].source_id, 'ts_38_331:5.3.2');
  });
});
