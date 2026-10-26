#!/usr/bin/env node
/**
 * Build SQLite corpus from structured extraction outputs.
 * Usage: node scripts/build_corpus.js [--rebuild] [--spec ts_24_301[,ts_36_523_1]]
 *          [--db path/to/3gpp.db] [--intermediate dir] [--replace]
 *
 *   --db            build into another DB (e.g. a staged copy) instead of data/corpus/3gpp.db
 *   --intermediate  read *_sections.jsonl from this dir (default data/intermediate,
 *                   or $THREEGPP_INTERMEDIATE_DIR)
 *   --replace       delete each loaded spec's existing rows first (clean re-ingest)
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
const replaceExisting = args.includes('--replace');
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const specArg = argValue('--spec');
const specFilters = specArg ? specArg.split(',').map(s => s.trim()).filter(Boolean) : [null];
const specFilter = specArg;

const dbPath = resolve(argValue('--db') || resolve(projectRoot, 'data/corpus/3gpp.db'));
const intermediateDir = resolve(
  argValue('--intermediate') || process.env.THREEGPP_INTERMEDIATE_DIR || resolve(projectRoot, 'data/intermediate'),
);

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
  const results = { specs: 0, sections: 0, toc_entries: 0, errors: [] };
  for (const filter of specFilters) {
    const r = loadStructuredSections(intermediateDir, dbPath, {
      strict: false,
      specFilter: filter,
      replaceExisting,
    });
    results.specs += r.specs;
    results.sections += r.sections;
    results.toc_entries += r.toc_entries;
    results.errors.push(...r.errors);
  }

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
