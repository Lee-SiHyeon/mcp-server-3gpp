#!/usr/bin/env node
/**
 * Build SQLite corpus from structured extraction outputs.
 * Usage: node scripts/build_corpus.js [--rebuild] [--spec ts_24_301]
 */
import { resolve } from 'path';
import { existsSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initDatabase } from '../src/db/schema.js';
import { loadStructuredSections } from '../src/ingest/loadDatabase.js';
import { closeConnection } from '../src/db/connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const args = process.argv.slice(2);
const rebuild = args.includes('--rebuild');
const specIdx = args.indexOf('--spec');
const specFilter = specIdx >= 0 ? args[specIdx + 1] : null;

const dbPath = resolve(projectRoot, 'data/corpus/3gpp.db');
const intermediateDir = resolve(projectRoot, 'data/intermediate');

if (rebuild && existsSync(dbPath)) {
  console.log('Rebuilding: removing existing database...');
  rmSync(dbPath);
}

console.log(`Database: ${dbPath}`);
console.log(`Source: ${intermediateDir}`);
if (specFilter) console.log(`Filter: ${specFilter}`);
console.log('');

// Initialize schema
const { features } = initDatabase(dbPath);
console.log(`Features: keyword=${features.ftsSearch}, vector=${features.vectorSearch}`);
console.log('');

// Load sections
try {
  const results = loadStructuredSections(intermediateDir, dbPath, {
    strict: false,
    specFilter,
  });

  console.log('\n=== Build Summary ===');
  console.log(`Specs loaded: ${results.specs}`);
  console.log(`Sections inserted: ${results.sections}`);
  console.log(`TOC entries: ${results.toc_entries}`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${results.errors.length}`);
    for (const err of results.errors.slice(0, 5)) {
      console.log(`  ⚠ ${err.specId}/${err.sectionId}: ${err.error}`);
    }
  }
} catch (e) {
  console.error(`Build failed: ${e.message}`);
  process.exit(1);
}

closeConnection();
console.log('\n✅ Corpus build complete');
