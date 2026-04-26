#!/usr/bin/env node

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from '../src/db/schema.js';
import { closeConnection } from '../src/db/connection.js';
import { createEmbeddingGenerator, ensureEmbeddingRuntimeReady } from '../src/embeddings/indexer.js';
import { getEmbeddingIndexStatus } from '../src/embeddings/indexMetadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const defaultDbPath = resolve(projectRoot, 'data/corpus/3gpp.db');

function parseArgs(argv) {
  const options = {
    dbPath: defaultDbPath,
    spec: null,
    batchSize: 16,
    rebuild: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--db':
        options.dbPath = resolve(argv[++i]);
        break;
      case '--spec':
        options.spec = argv[++i];
        break;
      case '--batch-size':
        options.batchSize = Number.parseInt(argv[++i], 10);
        break;
      case '--limit':
        options.limit = Number.parseInt(argv[++i], 10);
        break;
      case '--rebuild':
        options.rebuild = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer');
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }

  return options;
}

function printHelp() {
  console.log('Usage: node scripts/generate_embeddings.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --db <path>          Override database path');
  console.log('  --spec <spec_id>     Generate or refresh one spec scope');
  console.log('  --batch-size <n>     Embedding batch size (default: 16)');
  console.log('  --limit <n>          Limit sections processed (useful for smoke tests)');
  console.log('  --rebuild            Delete existing vectors in scope before regeneration');
  console.log('  -h, --help           Show this help');
}

export async function runGenerateEmbeddings(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { help: true };
  }

  console.log('=== Embedding Generation ===');
  console.log(`Database: ${options.dbPath}`);
  if (options.spec) {
    console.log(`Scope: ${options.spec}`);
  } else {
    console.log('Scope: full corpus');
  }

  const { db, features } = initDatabase(options.dbPath);

  if (!features.vectorSearch) {
    throw new Error('sqlite-vec extension is not available; vector indexing cannot run');
  }

  const runtimeInfo = await ensureEmbeddingRuntimeReady();
  const generateEmbeddingsIndex = createEmbeddingGenerator({
    runtimeInfo,
  });

  const result = await generateEmbeddingsIndex(db, {
    spec: options.spec,
    batchSize: options.batchSize,
    rebuild: options.rebuild,
    limit: options.limit,
  });

  const status = getEmbeddingIndexStatus(db);

  console.log(`Model: ${result.modelName}`);
  console.log(`Embedding dim: ${result.embeddingDim}`);
  console.log(`Policy signature: ${result.policySignature}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Processed: ${result.processed}`);
  console.log(`Selected scope rows: ${result.selected}/${result.targetSectionCount}`);
  console.log(`Indexed rows: ${result.vecRowCount}/${result.totalSectionCount}`);
  console.log(`Fresh semantic index available: ${status.available}`);
  if (!status.available) {
    console.log(`Freshness blockers: ${status.reasons.join(', ')}`);
  }

  return { ...result, status };
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMainModule) {
  try {
    await runGenerateEmbeddings();
    closeConnection();
  } catch (error) {
    closeConnection();
    console.error(`Embedding generation failed: ${error.message}`);
    process.exit(1);
  }
}
