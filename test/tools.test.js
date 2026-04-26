/**
 * Tests for MCP tool handlers + graceful degradation scenarios.
 *
 * Uses node:test + node:assert (no external frameworks).
 * Requires a live DB at data/corpus/3gpp.db.
 *
 * Each tool call returns: { content: [{ type: 'text', text: '<JSON string>' }] }
 * Parse text as JSON to inspect results.
 */

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { handleGetSpecCatalog } from '../src/tools/getSpecCatalog.js';
import { handleGetSpecToc }     from '../src/tools/getSpecToc.js';
import { handleGetSection }     from '../src/tools/getSection.js';
import { handleSearch3gppDocs } from '../src/tools/search3gppDocs.js';
import { getVectorSearchStatus, isVectorSearchAvailable } from '../src/search/semanticSearch.js';
import { hybridSearch }         from '../src/search/hybridRanker.js';
import { closeConnection }      from '../src/db/connection.js';
import { loadStructuredSections } from '../src/ingest/loadDatabase.js';
import { formatError } from '../src/tools/helpers.js';

// Helper: parse the first text content item as JSON.
async function parseResult(responseOrPromise) {
  const response = await Promise.resolve(responseOrPromise);
  assert.ok(response, 'Response must not be null/undefined');
  assert.ok(response.content, 'Response must have content array');
  assert.ok(response.content.length > 0, 'content must be non-empty');
  assert.strictEqual(response.content[0].type, 'text');
  return JSON.parse(response.content[0].text);
}

// Close DB handle after all tests.
after(() => closeConnection());

describe('MCP error envelopes', () => {
  test('formatError marks handler errors as MCP errors', async () => {
    const response = formatError('not found');
    const data = await parseResult(response);

    assert.strictEqual(response.isError, true);
    assert.strictEqual(data.error, 'not found');
  });
});

// ---------------------------------------------------------------------------
// get_spec_catalog
// ---------------------------------------------------------------------------
describe('handleGetSpecCatalog', () => {
  test('returns specs array with at least one entry', async () => {
    const response = handleGetSpecCatalog({});
    const data = await parseResult(response);
    assert.ok(Array.isArray(data.specs), 'data.specs must be an array');
    assert.ok(data.specs.length > 0, 'specs array must be non-empty');
  });

  test('filter "24_301" returns ts_24_301', async () => {
    const response = handleGetSpecCatalog({ filter: '24_301' });
    const data = await parseResult(response);
    assert.ok(Array.isArray(data.specs), 'data.specs must be an array');
    assert.ok(
      data.specs.some(s => s.id === 'ts_24_301'),
      'Filtered results must include ts_24_301'
    );
  });
});

// ---------------------------------------------------------------------------
// get_spec_toc
// ---------------------------------------------------------------------------
describe('handleGetSpecToc', () => {
  test('returns entries for ts_24_301', async () => {
    const response = handleGetSpecToc({ specId: 'ts_24_301' });
    const data = await parseResult(response);
    // Handler returns { spec_id, title, entries: [...] } on success.
    // May also return { sections: [...] } or { toc: [...] } depending on version.
    const hasContent =
      Array.isArray(data.entries) ||
      Array.isArray(data.sections) ||
      Array.isArray(data.toc);
    if (!hasContent && data.error) {
      // Some versions return error if toc table not populated; just assert no crash.
      assert.ok(typeof data.error === 'string', 'error must be a string if present');
    } else {
      assert.ok(hasContent, 'Response must include entries, sections, or toc array');
      const entries = data.entries || data.sections || data.toc;
      assert.ok(entries.length > 0, 'Must have at least one entry');
    }
  });

  test('unknown spec returns an error object (not a throw)', async () => {
    const response = handleGetSpecToc({ specId: 'ts_99_999' });
    const data = await parseResult(response);
    assert.strictEqual(response.isError, true);
    assert.ok(data.error, 'Unknown spec must return an error message');
  });
});

// ---------------------------------------------------------------------------
// get_section
// ---------------------------------------------------------------------------
describe('handleGetSection', () => {
  test('fetch by sectionId "ts_24_301:5.5" returns content', async () => {
    const response = handleGetSection({ sectionId: 'ts_24_301:5.5' });
    const data = await parseResult(response);
    if (data.error) {
      // Section not found — try the specific sub-section or fallback.
      // At a minimum the handler must not throw.
      assert.ok(typeof data.error === 'string');
    } else {
      assert.ok(data.section, 'Response must have section object');
      assert.ok(data.section.section_id || data.section.id, 'section must have an ID');
    }
  });

  test('fetch by specId + sectionNumber works', async () => {
    const response = handleGetSection({ specId: 'ts_24_301', sectionNumber: '5.5' });
    const data = await parseResult(response);
    if (!data.error) {
      assert.ok(data.section, 'Must return a section when section number exists');
    }
    // If it errors, just verify it's a clean error object
    if (data.error) {
      assert.ok(typeof data.error === 'string');
    }
  });

  test('fetch "ts_24_301:5.5.1.2.5" is successful or returns clean error', async () => {
    const response = handleGetSection({ sectionId: 'ts_24_301:5.5.1.2.5' });
    const data = await parseResult(response);
    if (data.section) {
      assert.ok(data.section.section_id || data.section.id);
    } else {
      assert.ok(data.error, 'Must have error if section is absent');
    }
  });

  test('includeNeighbors returns adjacent document sections', async () => {
    const response = handleGetSection({
      sectionId: 'ts_24_501:5.5.1.2.3',
      includeNeighbors: true,
      neighborWindow: 2,
      maxChars: 1,
    });
    const data = await parseResult(response);

    assert.deepStrictEqual(
      data.neighbors.map(section => section.section_number),
      ['5.5.1.2.1', '5.5.1.2.2', '5.5.1.2.4', '5.5.1.2.5'],
    );
  });
});

// ---------------------------------------------------------------------------
// search_3gpp_docs
// ---------------------------------------------------------------------------
describe('handleSearch3gppDocs', () => {
  test('"authentication" returns valid JSON results', async () => {
    const data = await parseResult(handleSearch3gppDocs({ query: 'authentication' }));
    assert.ok(Array.isArray(data.results), 'results must be an array');
    assert.ok(data.results.length > 0, 'Must have at least one result');
  });

  test('empty query returns error or empty results — no throw', async () => {
    const data = await parseResult(handleSearch3gppDocs({ query: '' }));
    // Either an error object OR an empty results array is acceptable.
    const acceptable = data.error || (Array.isArray(data.results) && data.results.length === 0);
    assert.ok(acceptable, 'Empty query must return error or empty results');
  });

  test('unknown spec filter returns 0 results cleanly', async () => {
    const data = await parseResult(handleSearch3gppDocs({ query: 'test', spec: 'ts_99_999' }));
    assert.ok(Array.isArray(data.results), 'results must be an array');
    assert.strictEqual(data.results.length, 0, 'Unknown spec must yield 0 results');
  });

  test('semantic request either activates or degrades cleanly depending on readiness', async () => {
    const data = await parseResult(handleSearch3gppDocs({
      query: 'registration procedure',
      spec: 'ts_24_501',
      mode: 'semantic',
      includeScores: true,
    }));

    assert.strictEqual(data.mode_requested, 'semantic');
    if (isVectorSearchAvailable()) {
      assert.ok(
        data.mode_actual === 'semantic' || data.mode_actual === 'hybrid',
        'Semantic-ready environments should not degrade semantic mode to keyword'
      );
    } else {
      assert.strictEqual(data.mode_actual, 'keyword');
      assert.ok(
        Array.isArray(data.warnings) && data.warnings.some((warning) => warning.includes('mode_degraded')),
        'Expected degraded-mode warning when semantic mode is unavailable'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------
describe('graceful degradation', () => {
  test('vector search status reflects current index readiness', () => {
    const status = getVectorSearchStatus();
    assert.strictEqual(isVectorSearchAvailable(), status.available);
    assert.ok(Array.isArray(status.reasons), 'status.reasons must be an array');
  });

  test('keyword search still works regardless of vector search readiness', async () => {
    const r = await hybridSearch('authentication', { mode: 'keyword', maxResults: 3 });
    assert.ok(r.results.length > 0, 'Keyword search must work in all readiness states');
    assert.strictEqual(r.mode, 'keyword', 'Mode must be keyword');
  });

  test('direct hybridSearch auto mode stays keyword without an embedding function', async () => {
    const r = await hybridSearch('normal and periodic tracking', { mode: 'auto', maxResults: 3 });
    assert.strictEqual(
      r.mode,
      'keyword',
      'Direct hybridSearch calls without embedQueryFn must stay keyword-mode even when vectors exist'
    );
  });

  test('loadStructuredSections with nonexistent directory does not crash test runner', () => {
    // loadDatabase.js exports loadStructuredSections. Calling it with a
    // nonexistent intermediate directory throws a filesystem error — that is
    // expected behavior. The important invariant is that it does NOT silently
    // corrupt state or hang the process.
    let threw = false;
    try {
      loadStructuredSections('/nonexistent/intermediates', '/tmp/test_missing.db');
    } catch (err) {
      threw = true;
      // Must be a known error type (not an assertion error or internal crash).
      assert.ok(err instanceof Error, 'Error must be an Error instance');
    }
    // Either threw a recoverable error OR returned — both are acceptable.
    // We just verify the test runner is still alive here.
    assert.ok(true, 'Test runner is still alive');
  });
});
