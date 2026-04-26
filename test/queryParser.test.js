import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/search/queryParser.js';

describe('phrase extraction', () => {
  test('single quoted phrase should be extracted and not in terms', () => {
    const result = parseQuery('"exact phrase"');
    assert.deepEqual(result.phrases, ['exact phrase']);
    assert(!result.terms.includes('exact'), 'exact should not be in terms');
    assert(!result.terms.includes('phrase'), 'phrase should not be in terms');
  });

  test('multiple quoted phrases should all be extracted', () => {
    const result = parseQuery('"phrase one" "phrase two"');
    assert.deepEqual(result.phrases, ['phrase one', 'phrase two']);
    assert.equal(result.terms.length, 0, 'terms should be empty');
  });
});

describe('negation handling', () => {
  test('dash-prefixed term should be in negatedTerms, not terms', () => {
    const result = parseQuery('attach -detach');
    assert.deepEqual(result.negatedTerms, ['detach']);
    assert(result.terms.includes('attach'), 'attach should be in terms');
    assert(!result.terms.includes('detach'), 'detach should not be in terms');
  });

  test('NOT keyword should negate the following term', () => {
    const result = parseQuery('message NOT rejected');
    assert(result.negatedTerms.includes('rejected'), 'rejected should be negated');
    assert(result.terms.includes('message'), 'message should be in terms');
    assert(!result.terms.includes('rejected'), 'rejected should not be in terms');
  });
});

describe('spec filter', () => {
  test('spec:xxx should extract spec filter and not appear in terms', () => {
    const result = parseQuery('spec:ts_24_301 attach');
    assert.equal(result.specFilter, 'ts_24_301');
    assert(result.terms.includes('attach'), 'attach should be in terms');
    assert(!result.terms.some(t => t.includes('spec')), 'spec filter should not be in terms');
  });

  test('spec filter should be lowercased', () => {
    const result = parseQuery('spec:TS_24_501 request');
    assert.equal(result.specFilter, 'ts_24_501');
  });
});

describe('section reference', () => {
  test('section:xxx should extract section reference and not appear in terms', () => {
    const result = parseQuery('section:5.5 EMM state');
    assert.equal(result.sectionRef, '5.5');
    assert.deepEqual(result.terms, ['EMM', 'state']);
  });
});

describe('boolean OR', () => {
  test('OR keyword should be skipped, not in terms', () => {
    const result = parseQuery('attach OR detach');
    assert.deepEqual(result.terms, ['attach', 'detach']);
    assert(!result.terms.includes('OR'), 'OR should not be in terms');
  });
});

describe('mode parsing', () => {
  test('mode: keyword should disable semantic search', () => {
    const result = parseQuery('test', { mode: 'keyword' });
    assert.equal(result.enableKeyword, true);
    assert.equal(result.enableSemantic, false);
  });

  test('mode: semantic should disable keyword search', () => {
    const result = parseQuery('test', { mode: 'semantic' });
    assert.equal(result.enableKeyword, false);
    assert.equal(result.enableSemantic, true);
  });

  test('default mode should enable both keyword and semantic', () => {
    const result = parseQuery('test');
    assert.equal(result.enableKeyword, true);
    assert.equal(result.enableSemantic, true);
  });
});

describe('edge cases', () => {
  test('empty query should not crash', () => {
    const result = parseQuery('');
    assert.equal(result.terms.length, 0);
    assert.equal(result.phrases.length, 0);
    assert.equal(result.negatedTerms.length, 0);
  });

  test('unicode query should be handled', () => {
    const result = parseQuery('인증 절차');
    assert(result.terms.length > 0, 'unicode terms should be extracted');
    assert(result.terms.includes('인증'), '인증 should be in terms');
    assert(result.terms.includes('절차'), '절차 should be in terms');
  });

  test('special characters should not crash', () => {
    const result = parseQuery('!@#$%');
    // Should not crash, result object should be valid
    assert(typeof result === 'object');
    assert(Array.isArray(result.terms));
  });

  test('very long query should not crash', () => {
    const longQuery = 'word ' + 'verylongword'.repeat(100);
    const result = parseQuery(longQuery);
    assert(Array.isArray(result.terms));
    assert(result.terms.length > 0, 'terms should be populated');
  });
});

describe('defaults and options', () => {
  test('default alpha should be 0.4 and default k should be 10', () => {
    const result = parseQuery('test');
    assert.equal(result.alpha, 0.4);
    assert.equal(result.k, 10);
  });

  test('custom alpha and k should be respected', () => {
    const result = parseQuery('test', { alpha: 0.7, k: 20 });
    assert.equal(result.alpha, 0.7);
    assert.equal(result.k, 20);
  });

  test('specFilter option should be passed through', () => {
    const result = parseQuery('search terms', { specFilter: 'ts_24_007' });
    assert.equal(result.specFilter, 'ts_24_007');
  });

  test('spec:xxx in query should override specFilter option', () => {
    const result = parseQuery('spec:ts_24_301 query', { specFilter: 'ts_24_007' });
    assert.equal(result.specFilter, 'ts_24_301', 'spec in query should override option');
  });
});

describe('complex queries', () => {
  test('combination of phrase, negation, spec filter, and section', () => {
    const result = parseQuery('spec:ts_24_301 section:5.5 "attach request" state -rejected');
    assert.equal(result.specFilter, 'ts_24_301');
    assert.equal(result.sectionRef, '5.5');
    assert.deepEqual(result.phrases, ['attach request']);
    assert(result.terms.includes('state'), 'state should be in terms');
    assert(!result.terms.includes('attach'), 'attach should not be separate term');
    assert(!result.terms.includes('request'), 'request should not be separate term');
    assert(result.negatedTerms.includes('rejected'), 'rejected should be negated');
  });

  test('raw query should always contain original input', () => {
    const original = 'spec:ts_24_301 attach';
    const result = parseQuery(original);
    assert.equal(result.raw, original);
  });

  test('normalizedText should combine phrases and terms', () => {
    const result = parseQuery('"exact phrase" word1 word2');
    const normalized = result.normalizedText;
    assert(normalized.includes('exact phrase'), 'normalized should include phrase');
    assert(normalized.includes('word1'), 'normalized should include word1');
    assert(normalized.includes('word2'), 'normalized should include word2');
  });

  test('5g mm is normalized to 5gmm', () => {
    const result = parseQuery('5g mm reject cause');
    assert(result.terms.includes('5gmm'), '5g mm should normalize to 5gmm');
    assert(!result.terms.includes('5g'), '5g should not remain as a separate term');
    assert(!result.terms.includes('mm'), 'mm should not remain as a separate term');
  });
});
