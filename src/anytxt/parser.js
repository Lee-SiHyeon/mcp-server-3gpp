/**
 * AnyTXT-based document text extraction.
 *
 * Uses AnyTXT Searcher's JSON-RPC API to extract text from local files.
 * Serves as a fallback/supplementary parser for formats that the primary
 * pipeline (PyMuPDF / python-docx) cannot handle:
 *
 * - Scanned PDFs (AnyTXT provides OCR)
 * - DOCX files (alternative to python-docx)
 * - XLSX files (currently unsupported by the pipeline)
 * - EPUB, MOBI, and other formats
 *
 * Usage:
 *   1. Install and run AnyTXT Searcher (Windows only)
 *   2. Enable HTTP API in AnyTXT settings (Help -> API)
 *   3. Sync the raw/ directory into AnyTXT's index
 *   4. Call extractFileText() for any file in the indexed directory
 *
 * The AnyTXT service must be running on localhost:9920.
 */

import { searchFiles, getFragmentAll, checkAvailability, syncIndex } from './client.js';

export async function isParserAvailable() {
  return checkAvailability();
}

export async function syncRawDirectory(rawDir) {
  return syncIndex(rawDir);
}

export async function extractFileText(filePath, options = {}) {
  const {
    host = '127.0.0.1',
    port = 9920,
  } = options;

  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  const fileName = filePath.replace(/.*[/\\]/, '');

  // Find the file in AnyTXT's index
  const searchResult = await searchFiles(fileName, {
    filterDir: dir,
    limit: 1,
    host,
    port,
  });

  if (!searchResult.ok || searchResult.files.length === 0) {
    return {
      ok: false,
      text: '',
      error: 'file_not_indexed',
      hint: `Sync "${dir}" via AnyTXT Index Manager first, or call syncRawDirectory("${dir}")`,
    };
  }

  const file = searchResult.files[0];

  // Extract full text via GetFragmentAll with empty pattern
  const fragmentResult = await getFragmentAll(file.id, '', { host, port });

  if (!fragmentResult.ok) {
    return { ok: false, text: '', error: fragmentResult.error };
  }

  const fullText = fragmentResult.fragments
    .map(f => typeof f === 'string' ? f : (f.text || ''))
    .filter(Boolean)
    .join('\n');

  return {
    ok: true,
    text: fullText,
    fileId: file.id,
    path: file.path,
    ext: file.ext,
    size: file.size,
  };
}

export async function extractBatch(filePaths, options = {}) {
  const results = [];
  for (const filePath of filePaths) {
    const result = await extractFileText(filePath, options);
    results.push({ filePath, ...result });
  }
  return results;
}

export async function extractUnprocessedFiles(rawDir, existingSpecIds, options = {}) {
  const {
    filterExt = '*.pdf',
    limit = 500,
    host = '127.0.0.1',
    port = 9920,
  } = options;

  const searchResult = await searchFiles('*', {
    filterDir: rawDir,
    filterExt,
    limit,
    host,
    port,
  });

  if (!searchResult.ok) return [];

  return searchResult.files.filter(file => {
    const fileName = file.path.replace(/.*[/\\]/, '').toLowerCase();
    const match = fileName.match(/^((?:ts|tr)_\d+_\d+(?:-\d+)?)/);
    if (!match) return false;
    return !existingSpecIds.includes(match[1]);
  });
}
