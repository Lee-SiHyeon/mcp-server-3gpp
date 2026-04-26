import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateSemanticReadiness } from '../validate.js';

describe('evaluateSemanticReadiness', () => {
  test('reports degraded readiness when optional prerequisites are missing', () => {
    const result = evaluateSemanticReadiness({
      vectorExtensionLoaded: false,
      vecCount: 0,
      transformersPackage: null,
      searchPayload: {
        mode_requested: 'auto',
        mode_actual: 'keyword',
        results: [],
        warnings: [],
      },
    });

    assert.strictEqual(result.optional, true);
    assert.strictEqual(result.prerequisites_met, false);
    assert.strictEqual(result.semantic_active, false);
    assert.match(result.reasons.join(' | '), /sqlite-vec extension is not loaded/);
    assert.match(result.reasons.join(' | '), /vec_sections has no embeddings/);
    assert.match(result.reasons.join(' | '), /no compatible transformers package is installed/);
    assert.match(result.reasons.join(' | '), /search_3gpp_docs stayed in keyword mode/);
  });

  test('reports semantic-active only when smoke results include semantic evidence', () => {
    const result = evaluateSemanticReadiness({
      vectorExtensionLoaded: true,
      vecCount: 42,
      transformersPackage: '@huggingface/transformers',
      searchPayload: {
        mode_requested: 'auto',
        mode_actual: 'hybrid',
        results: [
          {
            section_id: 'ts_24_501:5.5.1',
            evidence: ['keyword', 'semantic'],
          },
        ],
        warnings: [],
      },
    });

    assert.strictEqual(result.prerequisites_met, true);
    assert.strictEqual(result.semantic_active, true);
    assert.strictEqual(result.transformers_package, '@huggingface/transformers');
    assert.deepStrictEqual(result.reasons, []);
  });

  test('treats hybrid mode without semantic evidence as not yet semantic-active', () => {
    const result = evaluateSemanticReadiness({
      vectorExtensionLoaded: true,
      vecCount: 42,
      transformersPackage: '@xenova/transformers',
      searchPayload: {
        mode_requested: 'auto',
        mode_actual: 'hybrid',
        results: [
          {
            section_id: 'ts_24_501:5.5.1',
            evidence: ['keyword'],
          },
        ],
        warnings: [],
      },
    });

    assert.strictEqual(result.prerequisites_met, true);
    assert.strictEqual(result.semantic_active, false);
    assert.match(result.reasons.join(' | '), /did not include semantic evidence/);
  });
});
