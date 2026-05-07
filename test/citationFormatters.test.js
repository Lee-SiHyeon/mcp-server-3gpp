import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCitation } from '../src/citations/formatters.js';
import { parseSpecId } from '../src/citations/specId.js';

const source = {
  section_id: 'ts_38_331:5.3.2',
  spec_id: 'ts_38_331',
  doc_type: 'TS',
  doc_number: '38.331',
  spec_version: 'v18.3.0',
  section_number: '5.3.2',
  section_title: 'RRC connection establishment',
};

describe('parseSpecId', () => {
  test('parses canonical TS and TR ids', () => {
    assert.deepEqual(parseSpecId('ts_38_331'), { doc_type: 'TS', doc_number: '38.331' });
    assert.deepEqual(parseSpecId('tr_23_501'), { doc_type: 'TR', doc_number: '23.501' });
  });

  test('handles unknown formats gracefully', () => {
    assert.deepEqual(parseSpecId('rfc_9110'), { doc_type: '3GPP', doc_number: 'rfc_9110' });
    assert.deepEqual(parseSpecId(''), { doc_type: '3GPP', doc_number: '' });
  });
});

describe('formatCitation', () => {
  test('formats 3gpp style exactly', () => {
    assert.equal(
      formatCitation(source, '3gpp', 1),
      '3GPP TS 38.331 v18.3.0, Section 5.3.2, "RRC connection establishment"',
    );
  });

  test('formats ieee style exactly with bare version', () => {
    assert.equal(
      formatCitation(source, 'ieee', 1),
      '[1] 3GPP, "RRC connection establishment," 3GPP TS 38.331, sec. 5.3.2, version 18.3.0.',
    );
  });

  test('formats apa style exactly with bare version', () => {
    assert.equal(
      formatCitation(source, 'apa', 1),
      '3rd Generation Partnership Project. (n.d.). RRC connection establishment (3GPP TS 38.331, Section 5.3.2, Version 18.3.0).',
    );
  });

  test('formats plain style exactly', () => {
    assert.equal(
      formatCitation(source, 'plain', 1),
      '3GPP TS 38.331 v18.3.0 - Section 5.3.2 - RRC connection establishment',
    );
  });

  test('strips only one leading v for bare-version styles', () => {
    assert.equal(
      formatCitation({ ...source, spec_version: 'vv18.3.0' }, 'ieee', 2),
      '[2] 3GPP, "RRC connection establishment," 3GPP TS 38.331, sec. 5.3.2, version v18.3.0.',
    );
  });

  test('omits missing version gracefully', () => {
    const withoutVersion = { ...source, spec_version: null };

    assert.equal(
      formatCitation(withoutVersion, '3gpp', 1),
      '3GPP TS 38.331, Section 5.3.2, "RRC connection establishment"',
    );
    assert.equal(
      formatCitation(withoutVersion, 'ieee', 1),
      '[1] 3GPP, "RRC connection establishment," 3GPP TS 38.331, sec. 5.3.2.',
    );
    assert.equal(
      formatCitation(withoutVersion, 'apa', 1),
      '3rd Generation Partnership Project. (n.d.). RRC connection establishment (3GPP TS 38.331, Section 5.3.2).',
    );
    assert.equal(
      formatCitation(withoutVersion, 'plain', 1),
      '3GPP TS 38.331 - Section 5.3.2 - RRC connection establishment',
    );
  });

  test('defaults unknown style to 3gpp', () => {
    assert.equal(formatCitation(source, 'unknown', 1), formatCitation(source, '3gpp', 1));
  });
});
