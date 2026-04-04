/**
 * Tests for src/search/hybridRanker.js
 *
 * Uses node:test + node:assert (no external frameworks).
 * Requires a live DB at data/corpus/3gpp.db (26 specs, 31,777 sections).
 */

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hybridSearch } from '../src/search/hybridRanker.js';
import { closeConnection } from '../src/db/connection.js';

// Close the DB handle after all tests in this file.
after(() => closeConnection());

describe('hybridSearch — keyword mode', () => {
  test('returns results with expected fields for "authentication"', () => {
    const r = hybridSearch('authentication', { mode: 'keyword', maxResults: 5 });
    assert.ok(r.results.length > 0, 'Expected at least one result');
    assert.ok(r.results[0].section_id, 'result[0] must have section_id');
    assert.ok(r.results[0].spec_id,    'result[0] must have spec_id');
    assert.strictEqual(r.mode, 'keyword');
  });

  test('spec filter constrains results to the requested spec', () => {
    const r = hybridSearch('PDN connection', { spec: 'ts_24_301', maxResults: 5 });
    // Only relevant if results are returned; skip assertion if DB has no matches for the query.
    if (r.results.length > 0) {
      assert.ok(
        r.results.every(res => res.spec_id === 'ts_24_301'),
        'All results must belong to ts_24_301'
      );
    }
    // Either way, the spec_id field is present when results exist.
  });

  test('section number query does not throw', () => {
    // FTS5 searches section_number, section_title, and content.
    // Whether this returns hits depends on tokenization; we only assert no crash.
    const r = hybridSearch('5.5.1.2', { mode: 'keyword', maxResults: 3 });
    assert.ok(typeof r === 'object', 'result must be an object');
    assert.ok(Array.isArray(r.results), 'results must be an array');
  });

  test('nonsense query returns 0 results', () => {
    const r = hybridSearch('xyzzy_nonexistent_term_abc123', { mode: 'keyword' });
    assert.ok(
      r.results.length === 0 || r.totalHits === 0,
      'Nonsense query must yield no results'
    );
  });
});

describe('hybridSearch — edge cases', () => {
  test('empty string returns object without throwing', () => {
    const r = hybridSearch('');
    assert.ok(typeof r === 'object', 'Must return an object');
    assert.ok(Array.isArray(r.results), 'results must be an array');
  });

  test('whitespace-only string returns object without throwing', () => {
    const r = hybridSearch('   ');
    assert.ok(typeof r === 'object', 'Must return an object');
    assert.ok(Array.isArray(r.results), 'results must be an array');
  });

  test('result object always has required shape', () => {
    const r = hybridSearch('authentication', { mode: 'keyword', maxResults: 1 });
    assert.ok('mode' in r,        'result must have mode');
    assert.ok('page' in r,        'result must have page');
    assert.ok('maxResults' in r,  'result must have maxResults');
    assert.ok('totalHits' in r,   'result must have totalHits');
    assert.ok('capabilities' in r,'result must have capabilities');
    assert.ok('results' in r,     'result must have results');
  });
});
