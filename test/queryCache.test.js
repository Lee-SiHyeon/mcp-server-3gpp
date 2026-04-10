import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { queryCache, getQueryCacheStats } from '../src/search/queryCache.js';

describe('LRU Query Cache', () => {
  // Helper to reset cache state before each test
  const resetCache = () => {
    queryCache.clear();
    queryCache.resetStats();
  };

  test('basic set and get operations', () => {
    resetCache();
    queryCache.set('query1', { data: 'result1' });
    const result = queryCache.get('query1');
    assert.deepEqual(result, { data: 'result1' });
  });

  test('cache miss returns null', () => {
    resetCache();
    const result = queryCache.get('nonexistent');
    assert.strictEqual(result, null);
  });

  test('LRU eviction order: oldest item evicted when maxSize exceeded', () => {
    resetCache();
    // Temporarily reduce maxSize to 3 for testing
    const originalMaxSize = queryCache.maxSize;
    queryCache.maxSize = 3;

    queryCache.set('q1', { data: 1 });
    queryCache.set('q2', { data: 2 });
    queryCache.set('q3', { data: 3 });
    assert.strictEqual(queryCache.cache.size, 3);

    // Insert 4th item, should evict q1 (oldest)
    queryCache.set('q4', { data: 4 });
    assert.strictEqual(queryCache.cache.size, 3);
    assert.strictEqual(queryCache.get('q1'), null);

    // Restore original maxSize
    queryCache.maxSize = originalMaxSize;
  });

  test('TTL expiry: expired entries return null', async () => {
    resetCache();
    const originalTTL = queryCache.ttlSeconds;
    queryCache.ttlSeconds = 0.001; // 1 millisecond TTL

    queryCache.set('ttl-test', { data: 'should-expire' });
    
    // Wait long enough for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = queryCache.get('ttl-test');
    assert.strictEqual(result, null);

    // Restore original TTL
    queryCache.ttlSeconds = originalTTL;
  });

  test('cache hit/miss stats tracking', () => {
    resetCache();
    
    // 1 miss (get nonexistent)
    queryCache.get('nonexistent');
    
    // 1 set, 1 hit (get existing)
    queryCache.set('q1', { data: 'result' });
    queryCache.get('q1');
    
    // 1 miss (get nonexistent again)
    queryCache.get('nonexistent');

    const stats = queryCache.getStats();
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 2);
    assert.strictEqual(stats.hitRate, '33.3%');
  });

  test('cache key generation with different options', () => {
    resetCache();
    
    // Different queries should have different keys
    const key1 = queryCache._getCacheKey('query1', { spec: null, page: 1, mode: 'auto' });
    const key2 = queryCache._getCacheKey('query2', { spec: null, page: 1, mode: 'auto' });
    assert.notStrictEqual(key1, key2);

    // Different specs should have different keys
    const key3 = queryCache._getCacheKey('query1', { spec: 'ts_24_301', page: 1, mode: 'auto' });
    assert.notStrictEqual(key1, key3);

    // Different pages should have different keys
    const key4 = queryCache._getCacheKey('query1', { spec: null, page: 2, mode: 'auto' });
    assert.notStrictEqual(key1, key4);

    // Different modes should have different keys
    const key5 = queryCache._getCacheKey('query1', { spec: null, page: 1, mode: 'keyword' });
    assert.notStrictEqual(key1, key5);

    // Same parameters should produce same key
    const key6 = queryCache._getCacheKey('query1', { spec: null, page: 1, mode: 'auto' });
    assert.strictEqual(key1, key6);
  });

  test('LRU reordering: accessed item moves to end', () => {
    resetCache();
    const originalMaxSize = queryCache.maxSize;
    queryCache.maxSize = 3;

    queryCache.set('a', { data: 'a' });
    queryCache.set('b', { data: 'b' });
    queryCache.set('c', { data: 'c' });

    // Access 'a' to move it to end (most recently used)
    queryCache.get('a');

    // Insert 'd'; 'b' should be evicted (not 'a')
    queryCache.set('d', { data: 'd' });

    assert.deepEqual(queryCache.get('a'), { data: 'a' });
    assert.strictEqual(queryCache.get('b'), null);
    assert.deepEqual(queryCache.get('c'), { data: 'c' });
    assert.deepEqual(queryCache.get('d'), { data: 'd' });

    queryCache.maxSize = originalMaxSize;
  });

  test('clear() removes all entries and maintains size 0', () => {
    resetCache();
    
    queryCache.set('q1', { data: 1 });
    queryCache.set('q2', { data: 2 });
    assert.strictEqual(queryCache.cache.size, 2);

    queryCache.clear();
    assert.strictEqual(queryCache.cache.size, 0);
    assert.strictEqual(queryCache.get('q1'), null);
    assert.strictEqual(queryCache.get('q2'), null);
  });

  test('getStats() calculates hit rate correctly', () => {
    resetCache();

    // Perform operations: 5 hits, 5 misses = 50% hit rate
    for (let i = 0; i < 5; i++) {
      queryCache.set(`q${i}`, { data: i });
      queryCache.get(`q${i}`); // hit
      queryCache.get(`nonexistent-${i}`); // miss
    }

    const stats = queryCache.getStats();
    assert.strictEqual(stats.hits, 5);
    assert.strictEqual(stats.misses, 5);
    assert.strictEqual(stats.hitRate, '50.0%');
    assert.strictEqual(stats.size, 5);
    assert.strictEqual(stats.maxSize, 256);
  });

  test('set() overwrites existing entry with latest value', () => {
    resetCache();

    queryCache.set('q1', { data: 'old' });
    let result = queryCache.get('q1');
    assert.deepEqual(result, { data: 'old' });

    queryCache.set('q1', { data: 'new' });
    result = queryCache.get('q1');
    assert.deepEqual(result, { data: 'new' });

    const stats = queryCache.getStats();
    assert.strictEqual(stats.size, 1);
  });

  test('resetStats() clears all counters', () => {
    resetCache();

    queryCache.set('q1', { data: 'result' });
    queryCache.get('q1');
    queryCache.get('nonexistent');

    let stats = queryCache.getStats();
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 1);

    queryCache.resetStats();
    stats = queryCache.getStats();
    assert.strictEqual(stats.hits, 0);
    assert.strictEqual(stats.misses, 0);
    assert.strictEqual(stats.evictions, 0);
  });

  test('eviction counter increments correctly', () => {
    resetCache();
    const originalMaxSize = queryCache.maxSize;
    queryCache.maxSize = 2;

    queryCache.set('q1', { data: 1 });
    queryCache.set('q2', { data: 2 });
    let stats = queryCache.getStats();
    assert.strictEqual(stats.evictions, 0);

    queryCache.set('q3', { data: 3 });
    stats = queryCache.getStats();
    assert.strictEqual(stats.evictions, 1);

    queryCache.set('q4', { data: 4 });
    stats = queryCache.getStats();
    assert.strictEqual(stats.evictions, 2);

    queryCache.maxSize = originalMaxSize;
  });

  test('getQueryCacheStats() returns singleton stats', () => {
    resetCache();

    queryCache.set('q1', { data: 'result' });
    queryCache.get('q1');

    const stats = getQueryCacheStats();
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 0);
    assert.strictEqual(stats.size, 1);
  });
});
