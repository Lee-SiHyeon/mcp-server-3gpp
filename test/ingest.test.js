/**
 * Tests for src/ingest/sectionNormalizer.js
 *
 * Pure-function unit tests — no DB required.
 * Uses node:test + node:assert (no external frameworks).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSpecId,
  cleanSectionTitle,
  generateBrief,
  getParentSectionId,
  sectionDepth,
} from '../src/ingest/sectionNormalizer.js';

// ---------------------------------------------------------------------------
// normalizeSpecId
// ---------------------------------------------------------------------------
describe('normalizeSpecId', () => {
  test('"TS 24.301" → "ts_24_301"', () => {
    assert.strictEqual(normalizeSpecId('TS 24.301'), 'ts_24_301');
  });

  test('"ts_124301_v18.9.0_LTE_NAS" → "ts_24_301"', () => {
    assert.strictEqual(normalizeSpecId('ts_124301_v18.9.0_LTE_NAS'), 'ts_24_301');
  });

  test('"tr_137901_15.01.00" → "tr_37_901"', () => {
    assert.strictEqual(normalizeSpecId('tr_137901_15.01.00'), 'tr_37_901');
  });

  test('null → "unknown"', () => {
    assert.strictEqual(normalizeSpecId(null), 'unknown');
  });

  test('undefined → "unknown"', () => {
    assert.strictEqual(normalizeSpecId(undefined), 'unknown');
  });

  test('empty string → "unknown"', () => {
    assert.strictEqual(normalizeSpecId(''), 'unknown');
  });

  test('canonical form "ts_24_301" passes through unchanged', () => {
    assert.strictEqual(normalizeSpecId('ts_24_301'), 'ts_24_301');
  });

  test('"TS 24.501" → "ts_24_501"', () => {
    assert.strictEqual(normalizeSpecId('TS 24.501'), 'ts_24_501');
  });
});

// ---------------------------------------------------------------------------
// cleanSectionTitle
// ---------------------------------------------------------------------------
describe('cleanSectionTitle', () => {
  test('trims trailing whitespace', () => {
    const result = cleanSectionTitle('5.1 Authentication  ');
    assert.strictEqual(result, '5.1 Authentication');
  });

  test('empty string returns empty string', () => {
    const result = cleanSectionTitle('');
    assert.strictEqual(result, '');
  });

  test('null returns empty string', () => {
    const result = cleanSectionTitle(null);
    assert.strictEqual(result, '');
  });

  test('collapses internal multiple spaces', () => {
    const result = cleanSectionTitle('5.3  Security   Mode');
    assert.strictEqual(result, '5.3 Security Mode');
  });

  test('strips TOC filler dots with page number', () => {
    const result = cleanSectionTitle('5.3.2  Overview .......... 42');
    assert.ok(!result.includes('..'), `Should remove filler dots, got: "${result}"`);
  });
});

// ---------------------------------------------------------------------------
// generateBrief
// ---------------------------------------------------------------------------
describe('generateBrief', () => {
  test('result length <= maxLen (short maxLen)', () => {
    const brief = generateBrief('This is a sentence. This is another.', 50);
    // The result must not exceed maxLen characters.
    // Note: generateBrief truncates at sentence boundary first; length may be slightly
    // less than maxLen or equal when it falls back to word/char boundary.
    assert.ok(brief.length <= 50, `Brief "${brief}" is longer than 50 chars`);
  });

  test('empty content returns empty string', () => {
    assert.strictEqual(generateBrief('', 180), '');
  });

  test('short content returned unchanged', () => {
    const short = 'Short text.';
    assert.strictEqual(generateBrief(short, 180), short);
  });

  test('long content truncated near maxLen', () => {
    const long = 'word '.repeat(100);
    const brief = generateBrief(long, 80);
    assert.ok(brief.length <= 82, 'Brief must be close to maxLen (allowing ellipsis)');
  });

  test('null content returns empty string', () => {
    assert.strictEqual(generateBrief(null, 180), '');
  });
});

// ---------------------------------------------------------------------------
// getParentSectionId
// ---------------------------------------------------------------------------
describe('getParentSectionId', () => {
  test('"ts_24_301:5.3.2" → "ts_24_301:5.3"', () => {
    assert.strictEqual(getParentSectionId('ts_24_301:5.3.2'), 'ts_24_301:5.3');
  });

  test('"ts_24_301:5" → null (top-level)', () => {
    assert.strictEqual(getParentSectionId('ts_24_301:5'), null);
  });

  test('null input → null', () => {
    assert.strictEqual(getParentSectionId(null), null);
  });
});

// ---------------------------------------------------------------------------
// sectionDepth
// ---------------------------------------------------------------------------
describe('sectionDepth', () => {
  test('"5" → depth 0', () => {
    assert.strictEqual(sectionDepth('5'), 0);
  });

  test('"5.3" → depth 1', () => {
    assert.strictEqual(sectionDepth('5.3'), 1);
  });

  test('"5.3.2.1" → depth 3', () => {
    assert.strictEqual(sectionDepth('5.3.2.1'), 3);
  });

  test('null → depth 0', () => {
    assert.strictEqual(sectionDepth(null), 0);
  });
});
