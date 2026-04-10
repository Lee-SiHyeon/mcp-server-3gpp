/**
 * LRU Query Cache for hybrid search results
 * 
 * Caches search results to reduce latency for repeated queries.
 * Maintains memory limits and TTL.
 */

class LRUQueryCache {
  constructor(maxSize = 256, ttlSeconds = 3600) {
    this.maxSize = maxSize;
    this.ttlSeconds = ttlSeconds;
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }

  /**
   * Generate cache key from query parameters
   */
  _getCacheKey(query, options = {}) {
    const { spec = null, page = 1, mode = 'auto' } = options;
    return `${query}|${spec}|${page}|${mode}`;
  }

  /**
   * Get cached result if valid
   */
  get(query, options = {}) {
    const key = this._getCacheKey(query, options);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlSeconds * 1000) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry.result;
  }

  /**
   * Store result in cache
   */
  set(query, result, options = {}) {
    const key = this._getCacheKey(query, options);

    // Remove if exists
    this.cache.delete(key);

    // Add entry
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    // Evict LRU if over limit
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: `${hitRate}%`,
      maxSize: this.maxSize,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
}

export const queryCache = new LRUQueryCache(256, 3600);

export function getQueryCacheStats() {
  return queryCache.getStats();
}
