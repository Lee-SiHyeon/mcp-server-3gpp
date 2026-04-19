import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { closeConnection } from '../src/db/connection.js';
import { handleGetSection } from '../src/tools/getSection.js';
import { handleGetSpecToc } from '../src/tools/getSpecToc.js';

function parseResult(response) {
  assert.ok(response, 'Response must not be null/undefined');
  assert.ok(Array.isArray(response.content), 'Response must have content array');
  assert.ok(response.content.length > 0, 'Response content must be non-empty');
  assert.strictEqual(response.content[0].type, 'text');
  return JSON.parse(response.content[0].text);
}

after(() => closeConnection());

describe('section navigation fallbacks', () => {
  test('get_section returns navigation guidance for structural procedure headings', () => {
    const response = handleGetSection({ sectionId: 'ts_24_501:5.5.1' });
    const data = parseResult(response);

    assert.ok(data.section, 'Expected section payload');
    assert.strictEqual(data.section.section_id, 'ts_24_501:5.5.1');
    assert.strictEqual(data.section.content_length, 0);
    assert.strictEqual(data.section.has_content, false);
    assert.strictEqual(data.section.navigation_only, true);

    assert.ok(data.navigation, 'Expected navigation block for structural section');
    assert.ok(Array.isArray(data.navigation.child_sections), 'child_sections must be an array');
    assert.ok(data.navigation.child_sections.length > 0, 'Expected child section guidance');
    assert.ok(Array.isArray(data.navigation.suggested_sections), 'suggested_sections must be an array');
    assert.ok(data.navigation.suggested_sections.length > 0, 'Expected descendant suggestions');
    assert.ok(data.navigation.descendant_content_count > 0, 'Expected contentful descendants');

    const childIds = data.navigation.child_sections.map(section => section.section_id);
    assert.ok(childIds.includes('ts_24_501:5.5.1.1'), 'Expected 5.5.1.1 in child guidance');

    const suggestedIds = data.navigation.suggested_sections.map(section => section.section_id);
    assert.ok(
      suggestedIds.includes('ts_24_501:5.5.1.1') || suggestedIds.includes('ts_24_501:5.5.1.2.2'),
      'Expected a useful descendant suggestion under 5.5.1',
    );

    assert.ok(
      !/^general$/i.test(data.navigation.suggested_sections[0].section_title),
      'Suggested navigation should prioritize substantive descendants ahead of generic "General" sections',
    );

    const firstBrief = data.navigation.suggested_sections.find(section => section.brief)?.brief || '';
    assert.ok(firstBrief.length > 0, 'Expected a cleaned brief in navigation suggestions');
    assert.ok(
      !/\bETSI TS\b/i.test(firstBrief),
      'Navigation briefs should strip repetitive document header boilerplate',
    );
  });

  test('get_section keeps direct-content sections unchanged apart from content flags', () => {
    const response = handleGetSection({ sectionId: 'ts_24_501:5.5.1.1', maxChars: 400 });
    const data = parseResult(response);

    assert.ok(data.section, 'Expected section payload');
    assert.strictEqual(data.section.section_id, 'ts_24_501:5.5.1.1');
    assert.strictEqual(data.section.has_content, true);
    assert.ok(typeof data.section.content === 'string' && data.section.content.length > 0, 'Expected direct content');
    assert.ok(!data.navigation, 'Contentful sections should not emit navigation fallback');
  });

  test('get_spec_toc marks empty focus nodes and points to contentful descendants', () => {
    const response = handleGetSpecToc({ specId: 'ts_24_501', sectionPrefix: '5.5.1', maxDepth: 5 });
    const data = parseResult(response);

    assert.ok(Array.isArray(data.entries), 'Expected entries array');
    assert.ok(data.entries.length > 0, 'Expected subtree entries');
    assert.ok(data.focus_section, 'Expected focus section metadata');
    assert.strictEqual(data.focus_section.section_number, '5.5.1');
    assert.strictEqual(data.focus_section.has_content, false);
    assert.strictEqual(data.focus_section.navigation_only, true);

    assert.ok(data.navigation, 'Expected navigation block for empty focused prefix');
    assert.ok(data.navigation.suggested_sections.length > 0, 'Expected suggested descendant sections');
    assert.ok(
      !/^general$/i.test(data.navigation.suggested_sections[0].section_title),
      'TOC navigation should prioritize substantive descendants ahead of generic "General" sections',
    );

    const rootEntry = data.entries.find(entry => entry.section_number === '5.5.1');
    assert.ok(rootEntry, 'Expected root TOC entry in subtree');
    assert.strictEqual(rootEntry.has_content, false);
    assert.strictEqual(rootEntry.navigation_only, true);

    const contentfulDescendant = data.entries.find(entry => entry.section_number === '5.5.1.2.2');
    assert.ok(contentfulDescendant, 'Expected substantive descendant in subtree');
    assert.strictEqual(contentfulDescendant.has_content, true);
  });
});
