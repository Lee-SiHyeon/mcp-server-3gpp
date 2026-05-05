#!/usr/bin/env node

/**
 * AnyTXT-based document text extraction CLI.
 *
 * Extracts text from local files using AnyTXT Searcher's JSON-RPC API.
 * Useful as a fallback for scanned PDFs, DOCX files, and other formats
 * that PyMuPDF / python-docx may not handle well.
 *
 * Prerequisites:
 *   1. AnyTXT Searcher installed and running on Windows
 *   2. HTTP API enabled (AnyTXT menu → Help → API)
 *
 * Usage:
 *   node scripts/extract_anytxt.js <file_path>
 *   node scripts/extract_anytxt.js --sync <directory>
 *   node scripts/extract_anytxt.js --check
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node scripts/extract_anytxt.js <file_path>        Extract text from a file
  node scripts/extract_anytxt.js --sync <directory>  Sync a directory into AnyTXT index
  node scripts/extract_anytxt.js --check             Check if AnyTXT API is available
  node scripts/extract_anytxt.js --batch <dir>        Extract all unprocessed files in dir
`);
    process.exit(0);
  }

  const { checkAvailability, syncIndex } = await import('../src/anytxt/client.js');
  const { extractFileText, extractBatch, extractUnprocessedFiles } = await import('../src/anytxt/parser.js');

  if (args[0] === '--check') {
    const available = await checkAvailability();
    if (available) {
      console.log('AnyTXT API: available (localhost:9920)');
    } else {
      console.log('AnyTXT API: NOT available');
      console.log('Make sure AnyTXT Searcher is running and HTTP API is enabled.');
      process.exit(1);
    }
    return;
  }

  if (args[0] === '--sync') {
    const dir = args[1];
    if (!dir) {
      console.error('Error: --sync requires a directory path');
      process.exit(1);
    }
    console.log(`Syncing "${dir}" into AnyTXT index...`);
    const ok = await syncIndex(dir);
    console.log(ok ? 'Sync initiated.' : 'Sync failed.');
    return;
  }

  if (args[0] === '--batch') {
    const dir = args[1];
    if (!dir) {
      console.error('Error: --batch requires a directory path');
      process.exit(1);
    }

    const resolvedDir = path.resolve(dir);
    console.log(`Extracting text from all files in ${resolvedDir}...`);

    const glob = new URL(`file://${resolvedDir.replace(/\\/g, '/')}`);
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(resolvedDir)
      .filter(f => /\.(pdf|docx?|xlsx?|epub|mobi)$/i.test(f))
      .map(f => path.join(resolvedDir, f));

    if (files.length === 0) {
      console.log('No supported files found.');
      return;
    }

    console.log(`Found ${files.length} file(s).`);
    const results = await extractBatch(files);

    let ok = 0;
    let fail = 0;
    for (const r of results) {
      if (r.ok) {
        ok++;
        console.log(`  [OK] ${path.basename(r.filePath)}: ${r.text.length} chars`);
      } else {
        fail++;
        console.log(`  [FAIL] ${path.basename(r.filePath)}: ${r.error}`);
      }
    }
    console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
    return;
  }

  // Default: extract a single file
  const filePath = path.resolve(args[0]);
  console.log(`Extracting text from: ${filePath}`);

  const result = await extractFileText(filePath);

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    if (result.hint) console.error(result.hint);
    process.exit(1);
  }

  process.stdout.write(result.text);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
