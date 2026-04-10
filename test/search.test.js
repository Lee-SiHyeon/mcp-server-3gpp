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
import { queryCache, getQueryCacheStats } from '../src/search/queryCache.js';

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

describe('hybridSearch — scoring and fusion', () => {
  test('includeScores reveals score fields', () => {
    const r = hybridSearch('PDN', { mode: 'keyword', maxResults: 5, includeScores: true });
    assert.ok(r.results.length > 0, 'Expected at least one result for scoring test');
    const result = r.results[0];
    assert.ok('score' in result, 'result must have score field');
    assert.ok('keyword_score' in result, 'result must have keyword_score field');
    assert.ok('evidence' in result, 'result must have evidence field');
  });

  test('keyword-only mode: effectiveAlpha is 1.0', () => {
    const r = hybridSearch('PDN', { mode: 'keyword', maxResults: 5, includeScores: true });
    assert.ok(r.results.length > 0, 'Expected at least one result');
    const result = r.results[0];
    // In keyword mode, score should equal keyword_score (since alpha=1.0, semantic_score=0)
    assert.strictEqual(result.score, result.keyword_score, 'In keyword mode, score must equal keyword_score');
  });

  test('scores are clamped to [0, 1]', () => {
    const r = hybridSearch('PDN', { mode: 'keyword', maxResults: 10, includeScores: true });
    if (r.results.length > 0) {
      for (const result of r.results) {
        assert.ok(result.score >= 0 && result.score <= 1, `score ${result.score} must be in [0, 1]`);
        assert.ok(result.keyword_score >= 0 && result.keyword_score <= 1, `keyword_score ${result.keyword_score} must be in [0, 1]`);
      }
    }
  });

  test('mode hybrid falls back to keyword when no sqlite-vec', () => {
    const r = hybridSearch('PDN', { mode: 'hybrid', maxResults: 3 });
    // In this environment, sqlite-vec is not available, so hybrid should fall back to keyword
    assert.strictEqual(r.mode, 'keyword', 'mode should fall back to keyword when hybrid is requested but sqlite-vec unavailable');
  });

  test('mode semantic falls back to keyword', () => {
    const r = hybridSearch('PDN', { mode: 'semantic', maxResults: 3 });
    assert.strictEqual(r.mode, 'keyword', 'semantic mode should fall back to keyword when sqlite-vec unavailable');
  });
});

describe('hybridSearch — cache integration', () => {
  test('repeated query returns cached result', () => {
    queryCache.clear();
    queryCache.resetStats();
    
    const r1 = hybridSearch('PDN connection', { spec: 'ts_24_301', maxResults: 5 });
    const r2 = hybridSearch('PDN connection', { spec: 'ts_24_301', maxResults: 5 });
    
    assert.ok(!('cached' in r1) || r1.cached !== true, 'First call should not be marked as cached');
    assert.ok(r2.cached === true, 'Second call with identical params must be marked as cached');
  });

  test('useCache: false bypasses cache', () => {
    queryCache.clear();
    queryCache.resetStats();
    
    const r1 = hybridSearch('authentication', { mode: 'keyword', maxResults: 3 });
    const r2 = hybridSearch('authentication', { mode: 'keyword', maxResults: 3, useCache: false });
    
    assert.ok(!r2.cached || r2.cached !== true, 'Result with useCache: false should not have cached: true');
  });

  test('cache stats reflect usage', () => {
    queryCache.clear();
    queryCache.resetStats();
    
    hybridSearch('authentication', { mode: 'keyword', maxResults: 2 });
    hybridSearch('authentication', { mode: 'keyword', maxResults: 2 });
    hybridSearch('PDN', { mode: 'keyword', maxResults: 2 });
    hybridSearch('PDN', { mode: 'keyword', maxResults: 2 });
    
    const stats = getQueryCacheStats();
    assert.ok('hits' in stats, 'stats must have hits');
    assert.ok('misses' in stats, 'stats must have misses');
    assert.ok('size' in stats, 'stats must have size');
    assert.ok('hitRate' in stats, 'stats must have hitRate');
    assert.ok(stats.hits > 0, 'Expected cache hits from repeated queries');
    assert.ok(stats.misses >= 2, 'Expected at least 2 cache misses from 2 different queries');
  });
});
