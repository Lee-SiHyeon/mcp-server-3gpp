import { parseQuery } from './queryParser.js';
import { keywordSearch } from './keywordSearch.js';
import { semanticSearch, isVectorSearchAvailable } from './semanticSearch.js';
import { queryCache } from './queryCache.js';
import { getContentfulSectionsByTitle } from '../db/queries.js';

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'without',
]);

const GENERIC_TITLE_PATTERNS = [
  /^general$/i,
  /^overview$/i,
  /^introduction$/i,
  /^scope$/i,
  /^abnormal cases\b/i,
];

function normalizeSearchText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenizeSearchText(text) {
  return normalizeSearchText(text)
    .split(/\s+/)
    .filter(token => token && !TITLE_STOP_WORDS.has(token));
}

function isGenericTitle(title) {
  return GENERIC_TITLE_PATTERNS.some(pattern => pattern.test(title || ''));
}

function getSectionDepth(row) {
  if (Number.isFinite(row.depth)) return row.depth;
  if (!row.section_number) return 99;
  return row.section_number.split('.').length;
}

function getTitleSignal(title, queryTokens, normalizedQuery) {
  const normalizedTitle = normalizeSearchText(title);
  const titleTokens = new Set(tokenizeSearchText(title));
  const matchedTokenCount = queryTokens.filter(token => titleTokens.has(token)).length;
  const coverage = queryTokens.length > 0 ? matchedTokenCount / queryTokens.length : 0;
  const exact = Boolean(normalizedQuery) && normalizedTitle === normalizedQuery;
  const containsQuery = Boolean(normalizedQuery) && normalizedTitle.includes(normalizedQuery);
  const startsWithQuery = Boolean(normalizedQuery) &&
    (normalizedTitle === normalizedQuery || normalizedTitle.startsWith(`${normalizedQuery} `));

  return {
    coverage,
    exact,
    containsQuery,
    startsWithQuery,
    generic: isGenericTitle(title),
  };
}

function buildNavigationHint(row, titleSignal, parentSignal) {
  if (!row.parent_section_number || !row.parent_section_title) return null;
  if (!parentSignal.containsQuery && !parentSignal.exact && parentSignal.coverage < 0.5) return null;
  if (!titleSignal.generic && parentSignal.coverage <= titleSignal.coverage + 0.25 && !parentSignal.exact) {
    return null;
  }

  const parentSource = `${row.spec_id?.replace(/_/g, ' ').toUpperCase()} §${row.parent_section_number}`;
  return `Start with ${parentSource} ${row.parent_section_title}`;
}

function isDefinitionIntent(queryTokens) {
  return queryTokens.includes('cause');
}

function augmentExactTitleRescues(merged, parsed) {
  const normalizedQuery = normalizeSearchText(parsed.normalizedText);
  const queryTokens = tokenizeSearchText(parsed.normalizedText);
  const definitionIntent = isDefinitionIntent(queryTokens);

  if (!definitionIntent) {
    return;
  }

  for (const row of [...merged.values()]) {
    if (!row.spec_id || !row.section_title || (row.content_length ?? 0) > 0) {
      continue;
    }

    const titleSignal = getTitleSignal(row.section_title, queryTokens, normalizedQuery);
    if (!titleSignal.exact && titleSignal.coverage < 0.5) {
      continue;
    }

    const rescuedSections = getContentfulSectionsByTitle(row.spec_id, row.section_title, 5);
    for (const rescuedSection of rescuedSections) {
      if (rescuedSection.id === row.section_id) {
        continue;
      }

      const existing = merged.get(rescuedSection.id);
      const rescuedEvidence = new Set(existing?.evidence ?? []);
      for (const item of row.evidence ?? []) {
        rescuedEvidence.add(item);
      }
      rescuedEvidence.add('title_rescue');

      merged.set(rescuedSection.id, {
        ...(existing ?? {}),
        section_id: rescuedSection.id,
        spec_id: rescuedSection.spec_id,
        section_number: rescuedSection.section_number,
        section_title: rescuedSection.section_title,
        page_start: rescuedSection.page_start,
        page_end: rescuedSection.page_end,
        content_length: rescuedSection.content_length,
        snippet: existing?.snippet || rescuedSection.snippet || '',
        parent_section: rescuedSection.parent_section,
        depth: rescuedSection.depth,
        keyword_score: Math.max(existing?.keyword_score ?? 0, row.keyword_score * 0.95),
        semantic_score: Math.max(existing?.semantic_score ?? 0, row.semantic_score * 0.95),
        evidence: [...rescuedEvidence],
        rank_rescued_content: 2,
      });
    }
  }
}

function applyStructureAwareRanking(row, parsed) {
  const normalizedQuery = normalizeSearchText(parsed.normalizedText);
  const queryTokens = tokenizeSearchText(parsed.normalizedText);
  const definitionIntent = isDefinitionIntent(queryTokens);

  if (!normalizedQuery && queryTokens.length === 0) {
    row.navigation_hint = null;
    return;
  }

  const titleSignal = getTitleSignal(row.section_title, queryTokens, normalizedQuery);
  const parentSignal = getTitleSignal(row.parent_section_title, queryTokens, normalizedQuery);
  const depth = getSectionDepth(row);
  const shallowBoost = Math.max(0, 6 - depth) * 0.015;
  const hasContent = (row.content_length ?? 0) > 0;
  let structureDelta = 0;

  if (titleSignal.exact) {
    structureDelta += 0.05;
  } else {
    if (titleSignal.startsWithQuery) structureDelta += 0.025;
    else if (titleSignal.containsQuery) structureDelta += 0.015;

    structureDelta += 0.04 * titleSignal.coverage;
  }

  if (titleSignal.coverage >= 0.5 || titleSignal.exact) {
    structureDelta += shallowBoost * 0.5;
  } else if (depth >= 5) {
    structureDelta -= 0.015;
  }

  if (titleSignal.generic && !titleSignal.exact && titleSignal.coverage < 1) {
    structureDelta -= 0.05;
  }

  if (row.parent_section_title && parentSignal.exact && !titleSignal.exact &&
      (titleSignal.generic || titleSignal.coverage < 0.75)) {
    structureDelta -= 0.05;
  } else if (row.parent_section_title && parentSignal.coverage > titleSignal.coverage + 0.25) {
    structureDelta -= 0.03;
  }

  if (definitionIntent && !hasContent) {
    structureDelta -= 0.22;
  } else if (definitionIntent && hasContent && (titleSignal.exact || titleSignal.coverage >= 0.5)) {
    structureDelta += 0.12;
  }

  if (definitionIntent && hasContent && /(information element|reason why|indicate the reason)/i.test(row.snippet || '')) {
    structureDelta += 0.12;
  }

  if (row.rank_rescued_content) {
    structureDelta += row.rank_rescued_content === 2 ? 0.15 : 0.08;
  }

  row.rank_exactness = titleSignal.exact ? 1 : 0;
  row.rank_has_content = definitionIntent && hasContent ? 1 : 0;
  row.rank_title_coverage = titleSignal.coverage;
  row.rank_parent_anchor = parentSignal.exact && (titleSignal.generic || titleSignal.coverage < 0.75) ? 1 : 0;
  row.rank_generic_penalty = titleSignal.generic ? 1 : 0;
  row.rank_depth = depth;
  row.navigation_hint = buildNavigationHint(row, titleSignal, parentSignal);
  row.score = Math.max(0, Math.min(1, row.score + structureDelta));
}

function isUsableQueryVector(queryVector) {
  if (!queryVector) return false;
  if (typeof queryVector.length === 'number') return queryVector.length > 0;
  return ArrayBuffer.isView(queryVector);
}

function resolveSearchMode(requestedMode, semanticReady, warnings) {
  if (requestedMode === 'auto') {
    return semanticReady ? 'hybrid' : 'keyword';
  }

  if ((requestedMode === 'semantic' || requestedMode === 'hybrid') && !semanticReady) {
    warnings.push(`mode_degraded: requested=${requestedMode} actual=keyword`);
    return 'keyword';
  }

  return requestedMode;
}

function getEffectiveAlpha(mode, alpha) {
  if (mode === 'keyword') {
    return 1.0;
  }

  if (mode === 'semantic') {
    return 0.0;
  }

  return alpha;
}

/**
 * Perform hybrid keyword + semantic search with fusion scoring.
 *
 * score = α * keyword_score + (1-α) * semantic_score
 * Default α = 0.4 (favors semantic rescue while rewarding exact terms)
 *
 * Results are cached with LRU strategy to improve p95 latency for repeated queries.
 *
 * @param {string} query - Raw search query
 * @param {object} [options] - { spec, maxResults, page, mode, alpha, includeScores, embedQueryFn, useCache }
 * @returns {Promise<{ results: object[], mode: string, capabilities: object, page: number, maxResults: number, totalHits: number, warnings: string[], mode_requested: string, mode_actual: string, cached?: boolean }>}
 */
export async function hybridSearch(query, options = {}) {
  const {
    spec = null,
    maxResults = 5,
    page = 1,
    mode = 'auto',
    alpha = 0.4,
    includeScores = false,
    embedQueryFn = null,
    useCache = true,
  } = options;

  const warnings = [];
  const cacheNamespace = 'keyword-only';
  const cacheOptions = {
    spec,
    page,
    mode,
    maxResults,
    includeScores,
    alpha,
    cacheNamespace,
  };
  const cacheEligible = useCache && mode === 'keyword' && !embedQueryFn;

  // Runtime-dependent semantic/auto responses are not cached in v1.
  if (cacheEligible) {
    const cached = queryCache.get(query, cacheOptions);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const parsed = parseQuery(query, {
    specFilter: spec,
    mode,
    alpha,
    k: maxResults * 3,
  });

  const semanticRequested = mode === 'auto' || mode === 'semantic' || mode === 'hybrid';
  const vectorSearchAvailable = semanticRequested && isVectorSearchAvailable();
  let queryVector = null;
  let semanticReady = false;

  if (semanticRequested && vectorSearchAvailable && embedQueryFn) {
    try {
      queryVector = await embedQueryFn(parsed.normalizedText);
      semanticReady = isUsableQueryVector(queryVector);
    } catch (e) {
      console.error(`Embedding query failed: ${e.message}`);
      warnings.push(`semantic_search_failed: ${e.message}`);
    }
  }

  const actualMode = resolveSearchMode(mode, semanticReady, warnings);

  const capabilities = {
    keyword: true,
    semantic: semanticReady,
  };

  // Execute searches
  let keywordResults = [];
  let semanticResults = [];

  if (actualMode !== 'semantic') {
    keywordResults = keywordSearch(parsed);
  }

  if ((actualMode === 'semantic' || actualMode === 'hybrid') && semanticReady) {
    try {
      semanticResults = semanticSearch(queryVector, parsed.k * 3, parsed.specFilter);
    } catch (e) {
      console.error(`Semantic search failed: ${e.message}`);
      warnings.push(`semantic_search_failed: ${e.message}`);
    }
  }

  // Merge results
  const merged = new Map();

  for (const row of keywordResults) {
    merged.set(row.section_id, {
      ...row,
      keyword_score: row.keyword_score,
      semantic_score: 0,
      evidence: ['keyword'],
    });
  }

  for (const row of semanticResults) {
    if (merged.has(row.section_id)) {
      const existing = merged.get(row.section_id);
      existing.semantic_score = row.semantic_score;
      existing.evidence.push('semantic');
    } else {
      merged.set(row.section_id, {
        ...row,
        keyword_score: 0,
        semantic_score: row.semantic_score,
        evidence: ['semantic'],
      });
    }
  }

  augmentExactTitleRescues(merged, parsed);

  // Compute fused scores
  const effectiveAlpha = getEffectiveAlpha(actualMode, parsed.alpha);

  for (const row of merged.values()) {
    row.score = effectiveAlpha * row.keyword_score + (1 - effectiveAlpha) * row.semantic_score;

    // Boost exact section/title matches
    if (parsed.sectionRef && row.section_number === parsed.sectionRef) {
      row.score = Math.min(1, row.score + 0.08);
    }
    if (row.section_title && parsed.normalizedText &&
        row.section_title.toLowerCase().includes(parsed.normalizedText.toLowerCase())) {
      row.score = Math.min(1, row.score + 0.05);
    }

    applyStructureAwareRanking(row, parsed);
  }

  // Sort by score descending
  const ranked = [...merged.values()].sort((a, b) =>
    (b.rank_exactness ?? 0) - (a.rank_exactness ?? 0) ||
    (b.rank_has_content ?? 0) - (a.rank_has_content ?? 0) ||
    (b.rank_rescued_content ?? 0) - (a.rank_rescued_content ?? 0) ||
    b.score - a.score ||
    (b.rank_title_coverage ?? 0) - (a.rank_title_coverage ?? 0) ||
    (a.rank_generic_penalty ?? 0) - (b.rank_generic_penalty ?? 0) ||
    (a.rank_parent_anchor ?? 0) - (b.rank_parent_anchor ?? 0) ||
    (a.rank_depth ?? 99) - (b.rank_depth ?? 99) ||
    (a.section_number || '').localeCompare(b.section_number || '', undefined, { numeric: true })
  );

  // Paginate
  const startIdx = (page - 1) * maxResults;
  const pageResults = ranked.slice(startIdx, startIdx + maxResults);

  // Format results
  const results = pageResults.map(row => {
    const result = {
      section_id: row.section_id,
      spec_id: row.spec_id,
      section_number: row.section_number,
      title: row.section_title,
      source: `${row.spec_id?.replace(/_/g, ' ').toUpperCase()} §${row.section_number}`,
      content: row.snippet || '',
      page_start: row.page_start,
      page_end: row.page_end,
    };

    if (row.navigation_hint) {
      result.navigation_hint = row.navigation_hint;
    }

    if (includeScores) {
      result.score = Math.round(row.score * 1000) / 1000;
      result.keyword_score = Math.round(row.keyword_score * 1000) / 1000;
      result.semantic_score = Math.round(row.semantic_score * 1000) / 1000;
      result.evidence = row.evidence;
    }

    return result;
  });

  const response = {
    mode: actualMode,
    page,
    maxResults,
    totalHits: ranked.length,
    capabilities,
    warnings,
    mode_requested: mode,
    mode_actual: actualMode,
    results,
  };

  // Cache result for future calls
  if (cacheEligible) {
    queryCache.set(query, response, cacheOptions);
  }

  return response;
}

/**
 * Export cache for external monitoring/control
 */
export { queryCache, getQueryCacheStats } from './queryCache.js';
