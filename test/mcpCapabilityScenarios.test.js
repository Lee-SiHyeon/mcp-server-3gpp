import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { closeConnection } from '../src/db/connection.js';
import { handleGetSpecCatalog } from '../src/tools/getSpecCatalog.js';
import { handleSearch3gppDocs } from '../src/tools/search3gppDocs.js';
import { handleGetSpecToc } from '../src/tools/getSpecToc.js';
import { handleGetSection } from '../src/tools/getSection.js';
import { handleSearchRelatedSections } from '../src/tools/searchRelatedSections.js';
import { handleGetSpecReferences } from '../src/tools/getSpecReferences.js';
import { handleSearchEtsiCatalog } from '../src/tools/searchEtsiCatalog.js';
import { handleGetEtsiDocument } from '../src/tools/getEtsiDocument.js';
import { handleGetIngestGuide } from '../src/tools/getIngestGuide.js';
import { handleListSpecs } from '../src/tools/listSpecs.js';
import { validateArgs } from '../src/tools/validateArgs.js';

const KNOWN_SPEC = 'ts_24_501';
const KNOWN_STRUCTURAL_SECTION = 'ts_24_501:5.4.1';
const KNOWN_CONTENT_SECTION = 'ts_24_501:5.4.1.2.1';

after(() => closeConnection());

async function parseMcpJson(responseOrPromise) {
  const response = await Promise.resolve(responseOrPromise);
  assertMcpEnvelope(response);
  return {
    response,
    data: JSON.parse(response.content[0].text),
  };
}

function assertMcpEnvelope(response) {
  assert.ok(response, 'response must not be null or undefined');
  assert.ok(Array.isArray(response.content), 'response.content must be an array');
  assert.ok(response.content.length > 0, 'response.content must not be empty');
  assert.strictEqual(response.content[0].type, 'text');
  assert.strictEqual(typeof response.content[0].text, 'string');
}

function assertCleanError(response, data, messagePattern) {
  assert.strictEqual(response.isError, true, 'error responses must set isError');
  assert.ok(data.error, 'error payload must include an error field');
  if (messagePattern) {
    assert.match(String(data.error), messagePattern);
  }
}

function assertSpecShape(spec) {
  assert.strictEqual(typeof spec.id, 'string');
  assert.ok(spec.id.length > 0, 'spec id must be non-empty');
  assert.strictEqual(typeof spec.title, 'string');
  assert.ok('total_sections' in spec, 'spec must include section count');
}

function assertSearchShape(data) {
  assert.ok(['keyword', 'semantic', 'hybrid'].includes(data.mode), `unexpected mode ${data.mode}`);
  assert.ok(['auto', 'keyword', 'semantic', 'hybrid'].includes(data.mode_requested));
  assert.ok(['keyword', 'semantic', 'hybrid'].includes(data.mode_actual));
  assert.strictEqual(typeof data.page, 'number');
  assert.strictEqual(typeof data.maxResults, 'number');
  assert.strictEqual(typeof data.totalHits, 'number');
  assert.ok(data.capabilities && typeof data.capabilities === 'object');
  assert.ok(Array.isArray(data.warnings));
  assert.ok(Array.isArray(data.results));
}

function assertSearchResultShape(result) {
  assert.strictEqual(typeof result.section_id, 'string');
  assert.strictEqual(typeof result.spec_id, 'string');
  assert.strictEqual(typeof result.section_number, 'string');
  assert.strictEqual(typeof result.title, 'string');
  assert.strictEqual(typeof result.source, 'string');
  assert.ok('content' in result, 'search result must include content/snippet field');
}

function assertScoreBounds(result) {
  for (const field of ['score', 'keyword_score', 'semantic_score']) {
    if (field in result) {
      assert.ok(result[field] >= 0 && result[field] <= 1, `${field} must be within [0, 1]`);
    }
  }
}

function assertSectionShape(section) {
  assert.strictEqual(typeof section.section_id, 'string');
  assert.strictEqual(typeof section.spec_id, 'string');
  assert.strictEqual(typeof section.section_number, 'string');
  assert.strictEqual(typeof section.section_title, 'string');
  assert.strictEqual(typeof section.has_content, 'boolean');
  assert.ok('content_length' in section, 'section must expose content_length');
}

function assertTocEntryShape(entry) {
  assert.strictEqual(typeof entry.section_number, 'string');
  assert.strictEqual(typeof entry.section_title, 'string');
  assert.strictEqual(typeof entry.depth, 'number');
  assert.strictEqual(typeof entry.has_content, 'boolean');
}

function assertRelatedResultShape(result) {
  assert.strictEqual(typeof result.section_id, 'string');
  assert.strictEqual(typeof result.spec_id, 'string');
  assert.strictEqual(typeof result.section_number, 'string');
  assert.strictEqual(typeof result.title, 'string');
  assert.strictEqual(typeof result.relation, 'string');
  assert.ok(result.score >= 0 && result.score <= 1, 'related result score must be within [0, 1]');
}

function assertReferenceBlock(block) {
  assert.strictEqual(typeof block.description, 'string');
  assert.strictEqual(typeof block.count, 'number');
  assert.ok(Array.isArray(block.refs));
  assert.strictEqual(block.count, block.refs.length);
  for (const ref of block.refs) {
    assert.strictEqual(typeof ref.spec_id, 'string');
    assert.strictEqual(typeof ref.in_corpus, 'boolean');
    assert.strictEqual(typeof ref.mention_count, 'number');
  }
}

function assertCatalogStatusShape(status) {
  assert.ok(status && typeof status === 'object', 'catalog status must be an object');
  assert.ok(status.counts && typeof status.counts === 'object', 'catalog status must include counts');
  for (const key of ['publication_types', 'ranges', 'documents', 'versions', 'files']) {
    assert.strictEqual(typeof status.counts[key], 'number', `catalog count ${key} must be numeric`);
  }
}

describe('MCP capability scenarios - catalog discovery', () => {
  test('get_spec_catalog lists specs with stable metadata', async () => {
    const { data } = await parseMcpJson(handleGetSpecCatalog({}));

    assert.ok(Array.isArray(data.specs));
    assert.ok(data.specs.length > 0, 'catalog should expose at least one spec');
    assertSpecShape(data.specs[0]);
  });

  test('get_spec_catalog filters by exact spec id', async () => {
    const { data } = await parseMcpJson(handleGetSpecCatalog({ filter: KNOWN_SPEC }));

    assert.ok(data.specs.some(spec => spec.id === KNOWN_SPEC), `expected ${KNOWN_SPEC}`);
    for (const spec of data.specs) {
      assert.ok(
        spec.id.includes(KNOWN_SPEC) || spec.title.toLowerCase().includes(KNOWN_SPEC.toLowerCase()),
        'filtered catalog results should match id or title',
      );
    }
  });

  test('get_spec_catalog filters by family/series', async () => {
    const { data } = await parseMcpJson(handleGetSpecCatalog({ family: '24' }));

    assert.ok(data.specs.length > 0, 'family 24 should have catalog rows');
    assert.ok(data.specs.every(spec => spec.series === '24'));
  });

  test('get_spec_catalog escapes LIKE wildcard characters', async () => {
    const { data } = await parseMcpJson(handleGetSpecCatalog({ filter: '%_^' }));

    assert.ok(Array.isArray(data.specs), 'wildcard-like filter should return a clean array');
  });
});

describe('MCP capability scenarios - search', () => {
  test('search_3gpp_docs performs keyword search with scores', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: 'registration procedure',
      spec: KNOWN_SPEC,
      mode: 'keyword',
      maxResults: 5,
      includeScores: true,
    }));

    assertSearchShape(data);
    assert.strictEqual(data.mode_actual, 'keyword');
    assert.ok(data.results.length > 0, 'expected registration results');
    for (const result of data.results) {
      assertSearchResultShape(result);
      assert.strictEqual(result.spec_id, KNOWN_SPEC);
      assertScoreBounds(result);
      assert.ok(Array.isArray(result.evidence));
      assert.ok(result.evidence.includes('keyword'));
    }
  });

  test('search_3gpp_docs supports quoted phrases and query-level spec filters', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: '"registration procedure" spec:ts_24_501',
      mode: 'keyword',
      maxResults: 5,
    }));

    assertSearchShape(data);
    for (const result of data.results) {
      assert.strictEqual(result.spec_id, KNOWN_SPEC);
    }
  });

  test('search_3gpp_docs handles negation, boolean words, and punctuation without crashing', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: 'registration OR periodic -emergency (UE) cause?',
      mode: 'keyword',
      maxResults: 5,
    }));

    assertSearchShape(data);
  });

  test('search_3gpp_docs paginates without changing response shape', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: 'authentication',
      mode: 'keyword',
      maxResults: 3,
      page: 2,
    }));

    assertSearchShape(data);
    assert.strictEqual(data.page, 2);
    assert.strictEqual(data.maxResults, 3);
    assert.ok(data.results.length <= 3);
  });

  test('search_3gpp_docs clamps maxResults to the tool limit', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: 'authentication',
      mode: 'keyword',
      maxResults: 999,
    }));

    assertSearchShape(data);
    assert.strictEqual(data.maxResults, 20);
    assert.ok(data.results.length <= 20);
  });

  test('search_3gpp_docs returns clean error for empty query', async () => {
    const { response, data } = await parseMcpJson(handleSearch3gppDocs({ query: '   ' }));

    assertCleanError(response, data, /Query is required/);
  });

  test('search_3gpp_docs returns empty results for nonsense terms', async () => {
    const { data } = await parseMcpJson(handleSearch3gppDocs({
      query: 'xyzzy_nonexistent_term_abc123',
      mode: 'keyword',
    }));

    assertSearchShape(data);
    assert.strictEqual(data.results.length, 0);
  });
});

describe('MCP capability scenarios - TOC and sections', () => {
  test('get_spec_toc returns shallow navigable TOC entries', async () => {
    const { data } = await parseMcpJson(handleGetSpecToc({ specId: KNOWN_SPEC, maxDepth: 2 }));

    assert.strictEqual(data.spec_id, KNOWN_SPEC);
    assert.ok(Array.isArray(data.entries));
    assert.ok(data.entries.length > 0, 'TOC should expose entries');
    assertTocEntryShape(data.entries[0]);
    assert.ok(data.entries.every(entry => entry.depth < 2));
  });

  test('get_spec_toc focuses structural prefixes and suggests descendants', async () => {
    const { data } = await parseMcpJson(handleGetSpecToc({
      specId: KNOWN_SPEC,
      sectionPrefix: '5.4.1',
      maxDepth: 5,
    }));

    assert.ok(data.focus_section, 'focused TOC query should expose focus_section');
    assert.strictEqual(data.focus_section.section_number, '5.4.1');
    assert.strictEqual(data.focus_section.has_content, false);
    assert.ok(data.navigation, 'structural focus should include navigation');
    assert.ok(Array.isArray(data.navigation.child_sections));
    assert.ok(Array.isArray(data.navigation.suggested_sections));
    assert.ok(data.navigation.descendant_content_count > 0);
  });

  test('get_spec_toc omits briefs when requested', async () => {
    const { data } = await parseMcpJson(handleGetSpecToc({
      specId: KNOWN_SPEC,
      maxDepth: 2,
      includeBriefs: false,
    }));

    assert.ok(data.entries.length > 0);
    assert.ok(data.entries.every(entry => !('brief' in entry)));
  });

  test('get_spec_toc returns clean error for unknown spec', async () => {
    const { response, data } = await parseMcpJson(handleGetSpecToc({ specId: 'ts_99_999' }));

    assertCleanError(response, data, /Spec not found/);
    assert.ok(Array.isArray(data.available_specs));
  });

  test('get_section retrieves direct content by sectionId with truncation', async () => {
    const { data } = await parseMcpJson(handleGetSection({ sectionId: KNOWN_CONTENT_SECTION, maxChars: 120 }));

    assertSectionShape(data.section);
    assert.strictEqual(data.section.section_id, KNOWN_CONTENT_SECTION);
    assert.strictEqual(data.section.has_content, true);
    assert.ok(data.section.content.length <= 120);
    if (data.section.content_length > 120) {
      assert.strictEqual(data.section.truncated, true);
    }
  });

  test('get_section resolves specId plus sectionNumber', async () => {
    const { data } = await parseMcpJson(handleGetSection({ specId: KNOWN_SPEC, sectionNumber: '5.4.1.2.1', maxChars: 80 }));

    assertSectionShape(data.section);
    assert.strictEqual(data.section.section_id, KNOWN_CONTENT_SECTION);
  });

  test('get_section returns navigation for structural headings', async () => {
    const { data } = await parseMcpJson(handleGetSection({ sectionId: KNOWN_STRUCTURAL_SECTION }));

    assertSectionShape(data.section);
    assert.strictEqual(data.section.has_content, false);
    assert.strictEqual(data.section.navigation_only, true);
    assert.ok(data.navigation, 'structural section should include navigation block');
    assert.ok(data.navigation.child_sections.length > 0);
    assert.ok(data.navigation.suggested_sections.length > 0);
  });

  test('get_section supports neighbor windows including zero', async () => {
    const { data } = await parseMcpJson(handleGetSection({
      sectionId: KNOWN_CONTENT_SECTION,
      includeNeighbors: true,
      neighborWindow: 0,
      maxChars: 1,
    }));

    assert.ok(Array.isArray(data.neighbors));
    assert.strictEqual(data.neighbors.length, 0);
  });

  test('get_section returns suggestions for missing section', async () => {
    const { response, data } = await parseMcpJson(handleGetSection({ sectionId: 'ts_24_501:999.999' }));

    assertCleanError(response, data, /Section not found/);
    assert.ok(Array.isArray(data.suggestions));
  });

  test('get_section rejects missing identifiers cleanly', async () => {
    const { response, data } = await parseMcpJson(handleGetSection({}));

    assertCleanError(response, data, /Provide sectionId/);
  });
});

describe('MCP capability scenarios - related sections', () => {
  test('search_related_sections expands from an anchor section', async () => {
    const { data } = await parseMcpJson(handleSearchRelatedSections({
      sectionId: KNOWN_CONTENT_SECTION,
      maxResults: 8,
    }));

    assert.strictEqual(data.anchor.section_id, KNOWN_CONTENT_SECTION);
    assert.ok(Array.isArray(data.results));
    assert.ok(data.results.length > 0, 'anchor expansion should return related sections');
    data.results.forEach(assertRelatedResultShape);
    assert.ok(data.results.some(result => ['parent', 'sibling', 'child', 'keyword_related'].includes(result.relation)));
  });

  test('search_related_sections accepts specId plus sectionNumber anchors', async () => {
    const { data } = await parseMcpJson(handleSearchRelatedSections({
      specId: KNOWN_SPEC,
      sectionNumber: '5.4.1.2.1',
      maxResults: 3,
    }));

    assert.strictEqual(data.anchor.section_id, KNOWN_CONTENT_SECTION);
    assert.ok(data.results.length <= 3);
  });

  test('search_related_sections supports query fallback', async () => {
    const { data } = await parseMcpJson(handleSearchRelatedSections({
      query: 'authentication',
      maxResults: 4,
    }));

    assert.deepStrictEqual(data.anchor, { query: 'authentication' });
    assert.ok(Array.isArray(data.results));
    assert.ok(data.results.length <= 4);
    data.results.forEach(result => assert.strictEqual(result.relation, 'query_match'));
  });

  test('search_related_sections returns clean error when no anchor or query is supplied', async () => {
    const { response, data } = await parseMcpJson(handleSearchRelatedSections({}));

    assertCleanError(response, data, /Provide sectionId/);
  });

  test('search_related_sections returns clean error for a missing anchor', async () => {
    const { response, data } = await parseMcpJson(handleSearchRelatedSections({ sectionId: 'ts_24_501:999.999' }));

    assertCleanError(response, data, /Section not found/);
  });
});

describe('MCP capability scenarios - cross-spec references', () => {
  test('get_spec_references returns outgoing reference shape', async () => {
    const { data } = await parseMcpJson(handleGetSpecReferences({
      specId: KNOWN_SPEC,
      direction: 'outgoing',
      maxResults: 5,
    }));

    assert.strictEqual(data.spec_id, KNOWN_SPEC);
    assertReferenceBlock(data.outgoing);
    assert.ok(data.outgoing.count <= 5);
  });

  test('get_spec_references returns incoming reference shape', async () => {
    const { data } = await parseMcpJson(handleGetSpecReferences({
      specId: 'rfc_3261',
      direction: 'incoming',
      maxResults: 5,
    }));

    assert.strictEqual(data.spec_id, 'rfc_3261');
    assertReferenceBlock(data.incoming);
    assert.ok(data.incoming.count <= 5);
  });

  test('get_spec_references supports both directions and in-corpus filtering', async () => {
    const { data } = await parseMcpJson(handleGetSpecReferences({
      specId: KNOWN_SPEC,
      direction: 'both',
      inCorpusOnly: true,
      maxResults: 3,
    }));

    assertReferenceBlock(data.outgoing);
    assertReferenceBlock(data.incoming);
    assert.ok(data.outgoing.refs.every(ref => ref.in_corpus));
    assert.ok(data.outgoing.count <= 3);
    assert.ok(data.incoming.count <= 3);
  });

  test('get_spec_references returns suggestions for unknown specs', async () => {
    const { response, data } = await parseMcpJson(handleGetSpecReferences({ specId: 'ts_99_999' }));

    assertCleanError(response, data, /Spec not found/);
    assert.ok(Array.isArray(data.suggestions));
  });
});

describe('MCP capability scenarios - ETSI catalog', () => {
  test('search_etsi_catalog returns catalog status shape', async () => {
    const { data } = await parseMcpJson(handleSearchEtsiCatalog({ maxResults: 2 }));

    assertCatalogStatusShape(data.status);
    assert.ok(Array.isArray(data.documents));
    assert.ok(data.documents.length <= 2);
  });

  test('search_etsi_catalog supports mapped 3GPP filters', async () => {
    const { data } = await parseMcpJson(handleSearchEtsiCatalog({ mapped3gppSpec: 'TS 24.501', maxResults: 5 }));

    assertCatalogStatusShape(data.status);
    assert.ok(Array.isArray(data.documents));
    for (const document of data.documents) {
      assert.ok(document.mapped_3gpp_id === KNOWN_SPEC || document.mapped_3gpp_spec === 'TS 24.501');
    }
  });

  test('search_etsi_catalog handles empty-result filters cleanly', async () => {
    const { data } = await parseMcpJson(handleSearchEtsiCatalog({ query: 'definitely-no-such-etsi-document-xyz' }));

    assertCatalogStatusShape(data.status);
    assert.deepStrictEqual(data.documents, []);
  });

  test('get_etsi_document returns a clean not-found error', async () => {
    const { response, data } = await parseMcpJson(handleGetEtsiDocument({ documentId: 'does_not_exist' }));

    assertCleanError(response, data, /not found/);
  });

  test('get_etsi_document can inspect a catalog document discovered by search', async () => {
    const { data: searchData } = await parseMcpJson(handleSearchEtsiCatalog({ maxResults: 1, hasVersions: true }));

    if (searchData.documents.length === 0) {
      return;
    }

    const { data } = await parseMcpJson(handleGetEtsiDocument({
      documentId: searchData.documents[0].id,
      includeFiles: true,
      maxVersions: 3,
    }));

    assert.strictEqual(data.document.id, searchData.documents[0].id);
    assert.ok(Array.isArray(data.versions));
    assert.ok(data.versions.length <= 3);
    for (const version of data.versions) {
      assert.ok('version' in version);
      assert.ok(Array.isArray(version.files));
    }
  });
});

describe('MCP capability scenarios - guides, compatibility, and validation', () => {
  test('get_ingest_guide returns every guide type through all', async () => {
    const { data } = await parseMcpJson(handleGetIngestGuide({ type: 'all' }));

    for (const guideType of ['catalog', 'etsi', 'rfc', 'autorag']) {
      assert.ok(data.guides[guideType], `missing ${guideType} guide`);
      assert.strictEqual(typeof data.guides[guideType].title, 'string');
      assert.ok(Array.isArray(data.guides[guideType].steps));
    }
  });

  test('get_ingest_guide returns one requested guide', async () => {
    const { data } = await parseMcpJson(handleGetIngestGuide({ type: 'rfc' }));

    assert.strictEqual(data.guide.title, 'Downloading IETF RFC Documents');
    assert.ok(Array.isArray(data.guide.steps));
  });

  test('get_ingest_guide returns clean error for unknown guide type', async () => {
    const { response, data } = await parseMcpJson(handleGetIngestGuide({ type: 'missing' }));

    assertCleanError(response, data, /Unknown guide type/);
    assert.ok(data.available.includes('all'));
  });

  test('list_specs remains compatible with get_spec_catalog coverage', async () => {
    const { data: listData } = await parseMcpJson(handleListSpecs({}));
    const { data: catalogData } = await parseMcpJson(handleGetSpecCatalog({ filter: KNOWN_SPEC }));

    assert.ok(Array.isArray(listData.specs));
    assert.ok(listData.specs.some(spec => spec.spec_id === KNOWN_SPEC));
    assert.ok(catalogData.specs.some(spec => spec.id === KNOWN_SPEC));
  });

  test('validateArgs rejects out-of-range search maxResults before dispatch', () => {
    const validation = validateArgs('search_3gpp_docs', { query: 'authentication', maxResults: 101 });

    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.error.error, 'validation_error');
    assert.ok(validation.error.details.some(detail => detail.field === 'maxResults'));
  });

  test('validateArgs rejects invalid section neighbor windows before dispatch', () => {
    const validation = validateArgs('get_section', { sectionId: KNOWN_CONTENT_SECTION, neighborWindow: 11 });

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.error.details.some(detail => detail.field === 'neighborWindow'));
  });
});

describe('MCP capability scenarios - end-to-end navigation workflow', () => {
  test('catalog to search to section retrieval works without relying on rankings', async () => {
    const { data: catalogData } = await parseMcpJson(handleGetSpecCatalog({ filter: KNOWN_SPEC }));
    assert.ok(catalogData.specs.some(spec => spec.id === KNOWN_SPEC));

    const { data: searchData } = await parseMcpJson(handleSearch3gppDocs({
      query: 'registration procedure',
      spec: KNOWN_SPEC,
      mode: 'keyword',
      maxResults: 5,
    }));
    assertSearchShape(searchData);
    assert.ok(searchData.results.length > 0, 'workflow search should find a candidate section');

    const candidate = searchData.results.find(result => result.section_id) ?? searchData.results[0];
    const { data: sectionData } = await parseMcpJson(handleGetSection({
      sectionId: candidate.section_id,
      maxChars: 300,
    }));

    assertSectionShape(sectionData.section);
    assert.strictEqual(sectionData.section.section_id, candidate.section_id);
    if (!sectionData.section.has_content) {
      assert.ok(sectionData.navigation, 'structural workflow target should provide navigation guidance');
    }
  });
});