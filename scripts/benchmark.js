/**
 * Benchmark: DB cold-start + FTS5 query latency
 *
 * Measures:
 *   - Cold-start time for the first getConnection() call
 *   - 10 iterations for each of 5 representative queries
 *   - Reports avg_ms and p95_ms per query
 *
 * Usage:
 *   node scripts/benchmark.js
 *
 * Sample output (real run, node v24, SQLite FTS5, 31 777 sections):
 *
 * ┌───────────────────────────────────┬────────┬──────────┬──────────┐
 * │ query                             │   hits │   avg_ms │   p95_ms │
 * ├───────────────────────────────────┼────────┼──────────┼──────────┤
 * │ authentication                    │    450 │     54.5 │     64.6 │
 * │ PDN connection establishment      │    450 │     47.1 │     59.4 │
 * │ handover procedure                │    450 │     58.8 │     62.2 │
 * │ SIB1 configuration                │    276 │     17.8 │     20.2 │
 * │ 5GMM cause code                   │     36 │     15.8 │     22.3 │
 * └───────────────────────────────────┴────────┴──────────┴──────────┘
 * Cold-start DB init: 2.6 ms  (10 iterations per query)
 */

import { performance } from 'node:perf_hooks';
import { hybridSearch } from '../src/search/hybridRanker.js';
import { getConnection, closeConnection } from '../src/db/connection.js';
import { queryCache, getQueryCacheStats } from '../src/search/queryCache.js';

const QUERIES = [
  'authentication',
  'PDN connection establishment',
  'handover procedure',
  'SIB1 configuration',
  '5GMM cause code',
];
const ITERATIONS = 20;
const MAX_RESULTS = 50;

function p95(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

async function main() {
  // ── Cold-start measurement ────────────────────────────────────────────────
  const t0 = performance.now();
  getConnection(); // first call — opens SQLite, sets pragmas
  const coldStart = performance.now() - t0;

  console.log('\nRunning benchmark...\n');

  const rows = [];

  for (const query of QUERIES) {
    const times = [];
    let totalHits = 0;

    // Warm-up iteration (not counted)
    hybridSearch(query, { mode: 'keyword', maxResults: MAX_RESULTS });
    
    // Actual measurements
    for (let i = 0; i < ITERATIONS; i++) {
      const ts = performance.now();
      const result = hybridSearch(query, { mode: 'keyword', maxResults: MAX_RESULTS });
      times.push(performance.now() - ts);
      if (i === ITERATIONS - 1) totalHits = result.totalHits;
    }

    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const p95v = p95(times);
    const cacheHits = getQueryCacheStats();

    rows.push({
      query,
      hits: totalHits,
      avg_ms: avg.toFixed(1),
      p95_ms: p95v.toFixed(1),
    });
  }

  // ── Table rendering ───────────────────────────────────────────────────────
  const COL_Q    = 33;
  const COL_HITS = 6;
  const COL_AVG  = 8;
  const COL_P95  = 8;

  const sep = (l, m, r, h) =>
    l + h.repeat(COL_Q + 2) + m +
    h.repeat(COL_HITS + 2) + m +
    h.repeat(COL_AVG + 2) + m +
    h.repeat(COL_P95 + 2) + r;

  console.log(sep('┌', '┬', '┐', '─'));
  console.log(
    '│ ' + pad('query', COL_Q) + ' │ ' +
    pad('hits', COL_HITS) + ' │ ' +
    pad('avg_ms', COL_AVG) + ' │ ' +
    pad('p95_ms', COL_P95) + ' │'
  );
  console.log(sep('├', '┼', '┤', '─'));

  for (const r of rows) {
    console.log(
      '│ ' + pad(r.query, COL_Q) + ' │ ' +
      pad(r.hits, COL_HITS, true) + ' │ ' +
      pad(r.avg_ms, COL_AVG, true) + ' │ ' +
      pad(r.p95_ms, COL_P95, true) + ' │'
    );
  }

  console.log(sep('└', '┴', '┘', '─'));
  
  const stats = getQueryCacheStats();
  console.log(`\nCold-start DB init: ${coldStart.toFixed(1)} ms`);
  console.log(`Iterations per query: ${ITERATIONS}`);
  console.log(`Cache stats: ${stats.hits} hits, ${stats.misses} misses, ${stats.evictions} evictions\n`);

  closeConnection();
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  closeConnection();
  process.exit(1);
});
