import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDatabase } from '../src/db/schema.js';
import { closeConnection, getConnection, resetConnection } from '../src/db/connection.js';
import { createEmbeddingGenerator, buildSectionPassage } from '../src/embeddings/indexer.js';
import {
  buildEmbeddingPolicySignature,
  getEmbeddingIndexStatus,
  upsertEmbeddingMetadata,
} from '../src/embeddings/indexMetadata.js';
import {
  EMBEDDING_DIM,
  EMBEDDING_POLICY_VERSION,
  MODEL_NAME,
  PASSAGE_PREFIX,
  PREFIX_POLICY_VERSION,
  QUERY_PREFIX,
  formatPassageText,
  formatQueryText,
} from '../src/embeddings/pipeline.js';
import { semanticSearch } from '../src/search/semanticSearch.js';

const tempPaths = new Set();

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-3gpp-embeddings-'));
  const dbPath = path.join(dir, 'test.db');
  tempPaths.add(dir);
  return dbPath;
}

function cleanupPath(dir) {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = suffix ? `${path.join(dir, 'test.db')}${suffix}` : path.join(dir, 'test.db');
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function seedSections(db) {
  db.prepare(
    `INSERT INTO specs(id, title, version)
     VALUES (?, ?, ?)`
  ).run('ts_24_501', '5GS mobility management', 'v18.0.0');

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
      id: 'ts_24_501:5.5.1',
      section_number: '5.5.1',
      section_title: 'Registration procedure',
      content: 'UE registration and mobility management overview.',
    },
    {
      id: 'ts_24_501:5.5.1.2',
      section_number: '5.5.1.2',
      section_title: 'Registration procedure for initial registration',
      content: 'Initial registration flow between UE and AMF.',
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
      null,
      row.section_number.split('.').length
    );
  }
}

function createStubGenerator() {
  return createEmbeddingGenerator({
    runtimeInfo: {
      modelName: MODEL_NAME,
    },
    embedTexts: async (texts) =>
      texts.map((_, index) => new Float32Array(EMBEDDING_DIM).fill(index + 1)),
  });
}

after(() => {
  resetConnection();
  closeConnection();
  for (const dir of tempPaths) {
    cleanupPath(dir);
  }
});

describe('embedding prefix helpers', () => {
  test('query and passage helpers normalize text and enforce prefixes', () => {
    assert.strictEqual(formatQueryText('  attach request  '), 'query: attach request');
    assert.strictEqual(formatPassageText('query: wrong prefix'), 'passage: wrong prefix');
    assert.strictEqual(formatQueryText('passage: mixed  whitespace'), 'query: mixed whitespace');
  });

  test('section passages include identifying header text', () => {
    const passage = buildSectionPassage({
      spec_id: 'ts_24_501',
      section_number: '5.5.1',
      section_title: 'Registration procedure',
      content: 'UE registration and mobility management overview.',
    });

    assert.match(passage, /TS 24\.501 Section 5\.5\.1 Registration procedure/);
    assert.match(passage, /UE registration and mobility management overview/);
  });
});

describe('embedding index generation', () => {
  test('full generation populates vec_sections and marks the index fresh', async () => {
    const dbPath = makeTempDbPath();
    const { db, features } = initDatabase(dbPath);
    assert.ok(features.vectorSearch, 'sqlite-vec must be available for this test');
    seedSections(db);

    const generator = createStubGenerator();
    const result = await generator(db, { batchSize: 1 });
    const status = getEmbeddingIndexStatus(db);

    assert.deepStrictEqual(
      {
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        processed: result.processed,
        selected: result.selected,
      },
      {
        inserted: 2,
        updated: 0,
        skipped: 0,
        processed: 2,
        selected: 2,
      }
    );
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.vecRowCount, 2);
    db.close();

    resetConnection();
    getConnection(dbPath);
    const results = semanticSearch(new Float32Array(EMBEDDING_DIM).fill(1), 5, 'ts_24_501');
    assert.ok(results.length > 0, 'semantic search should return indexed rows');
    resetConnection();
  });

  test('rerun without rebuild skips existing vectors', async () => {
    const dbPath = makeTempDbPath();
    const { db } = initDatabase(dbPath);
    seedSections(db);

    const generator = createStubGenerator();
    await generator(db, {});
    const rerun = await generator(db, {});

    assert.strictEqual(rerun.inserted, 0);
    assert.strictEqual(rerun.updated, 0);
    assert.strictEqual(rerun.skipped, 2);
    assert.strictEqual(rerun.processed, 0);
    db.close();
  });

  test('spec-scoped generation rejects stale policy metadata', async () => {
    const dbPath = makeTempDbPath();
    const { db } = initDatabase(dbPath);
    seedSections(db);

    upsertEmbeddingMetadata(db, {
      indexName: 'sections',
      modelName: MODEL_NAME,
      embeddingDim: EMBEDDING_DIM,
      queryPrefix: QUERY_PREFIX,
      passagePrefix: PASSAGE_PREFIX,
      prefixPolicyVersion: PREFIX_POLICY_VERSION,
      policyVersion: EMBEDDING_POLICY_VERSION,
      policySignature: `${buildEmbeddingPolicySignature()}-stale`,
      sectionCount: 2,
      vecRowCount: 2,
      lastBuiltScope: 'all',
      lastBuiltSpecId: null,
    });

    const generator = createStubGenerator();

    await assert.rejects(
      () => generator(db, { spec: 'ts_24_501' }),
      /run a full rebuild without --spec/
    );

    db.close();
  });

  test('partial generation keeps semantic availability disabled until the full corpus is indexed', async () => {
    const dbPath = makeTempDbPath();
    const { db } = initDatabase(dbPath);
    seedSections(db);

    const generator = createStubGenerator();
    await generator(db, { limit: 1 });
    const status = getEmbeddingIndexStatus(db);

    assert.strictEqual(status.available, false);
    assert.ok(status.reasons.includes('incomplete_index'));
    db.close();
  });
});
