#!/usr/bin/env node
/**
 * One-shot migration from legacy chunks.json to SQLite.
 * Usage: node scripts/migrate_legacy_json_to_sqlite.js [chunks-path] [db-path]
 */
import { resolve } from 'path';
import { existsSync } from 'fs';
import { initDatabase } from '../src/db/schema.js';
import { migrateLegacyChunks } from '../src/ingest/migrateLegacyChunks.js';
import { closeConnection } from '../src/db/connection.js';

const chunksPath = resolve(process.argv[2] || 'data/chunks.json');
const dbPath = resolve(process.argv[3] || 'data/corpus/3gpp.db');

if (!existsSync(chunksPath)) {
  console.error(`Error: chunks file not found: ${chunksPath}`);
  process.exit(1);
}

console.log(`Migrating: ${chunksPath}`);
console.log(`Target DB: ${dbPath}`);
console.log('');

// Initialize database schema first
const { db, features } = initDatabase(dbPath);
console.log(`DB features: ${JSON.stringify(features)}`);

// Run migration
const report = migrateLegacyChunks(chunksPath, dbPath);

console.log('\n=== Migration Report ===');
console.log(`Total chunks: ${report.total_chunks}`);
console.log(`Specs found: ${report.specs_found}`);
console.log(`Synthetic sections created: ${report.synthetic_sections}`);
console.log(`Empty chunks rejected: ${report.empty_rejected}`);
console.log('\nPer-spec breakdown:');
for (const [specId, info] of Object.entries(report.specs)) {
  console.log(`  ${specId}: ${info.chunks} chunks → ${info.inserted} sections`);
}

closeConnection();
console.log('\n✅ Migration complete');
