import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { closeConnection, getConnection, resetConnection } from '../src/db/connection.js';
import { createEmbeddingGenerator } from '../src/embeddings/indexer.js';
import { EMBEDDING_DIM, MODEL_NAME } from '../src/embeddings/pipeline.js';
import { hybridSearch } from '../src/search/hybridRanker.js';

const tempDirs = new Set();

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-3gpp-ranking-'));
  tempDirs.add(dir);
  return path.join(dir, 'test.db');
}

function cleanupDir(dir) {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = suffix ? `${path.join(dir, 'test.db')}${suffix}` : path.join(dir, 'test.db');
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function seedCauseSections(db) {
  db.prepare(
    `INSERT INTO specs(id, title, version)
     VALUES (?, ?, ?)`
  ).run('ts_24_501', '5GS mobility management', 'v19.5.0');

  const insertSection = db.prepare(
    `INSERT INTO sections(
      id,
      spec_id,
      section_number,
      section_title,
      page_start,
      page_end,
      content,
      content_length,
      parent_section,
      depth
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const rows = [
    {
      id: 'ts_24_501:8.2.11.4',
      section_number: '8.2.11.4',
      section_title: '5GMM cause',
      content: '',
      parent_section: 'ts_24_501:8.2.11',
      depth: 4,
    },
    {
      id: 'ts_24_501:9.11.3.2',
      section_number: '9.11.3.2',
      section_title: '5GMM cause',
      content: 'The purpose of the 5GMM cause information element is to indicate the reason why a 5GMM request is rejected.',
      parent_section: 'ts_24_501:9.11.3',
      depth: 3,
    },
  ];

  for (const row of rows) {
    insertSection.run(
      row.id,
      'ts_24_501',
      row.section_number,
      row.section_title,
      1,
      2,
      row.content,
      row.content.length,
      row.parent_section,
      row.depth,
    );
  }
}

function createStubGenerator() {
  return createEmbeddingGenerator({
    runtimeInfo: { modelName: MODEL_NAME },
    embedTexts: async (texts, rows) => texts.map((_, index) => {
      const vector = new Float32Array(EMBEDDING_DIM);
      vector[0] = rows[index].id === 'ts_24_501:8.2.11.4' ? 1 : 0.95;
      return vector;
    }),
  });
}

after(() => {
  resetConnection();
  closeConnection();
  for (const dir of tempDirs) {
    cleanupDir(dir);
  }
});

describe('hybridSearch — contentful title rescue', () => {
  test('definition intent prefers a contentful clause over an empty structural heading with the same title', async () => {
    const dbPath = makeTempDbPath();
    const { db, features } = initDatabase(dbPath);
    assert.ok(features.vectorSearch, 'sqlite-vec must be available for this test');
    seedCauseSections(db);

    const generator = createStubGenerator();
    await generator(db, {});
    db.close();

    resetConnection();
    getConnection(dbPath);

    const queryVector = new Float32Array(EMBEDDING_DIM);
    queryVector[0] = 1;

    const result = await hybridSearch('5g mm reject cause에 대해서 알려줘', {
      mode: 'auto',
      spec: 'ts_24_501',
      maxResults: 5,
      includeScores: true,
      embedQueryFn: async () => queryVector,
      useCache: false,
    });

    assert.strictEqual(result.mode, 'hybrid');
    assert.strictEqual(result.results[0].section_id, 'ts_24_501:9.11.3.2');
    assert.ok(
      result.results[0].evidence.includes('title_rescue'),
      'Expected rescued contentful title evidence on the promoted clause',
    );
    assert.match(
      result.results[0].content,
      /reason why a 5GMM request is rejected/i,
      'Expected a non-empty rescued preview from the promoted contentful clause',
    );
  });
});
