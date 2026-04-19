import { parseQuery } from './queryParser.js';
import { keywordSearch } from './keywordSearch.js';
import { semanticSearch, isVectorSearchAvailable } from './semanticSearch.js';
import { queryCache } from './queryCache.js';

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

function applyStructureAwareRanking(row, parsed) {
  const normalizedQuery = normalizeSearchText(parsed.normalizedText);
  const queryTokens = tokenizeSearchText(parsed.normalizedText);

  if (!normalizedQuery && queryTokens.length === 0) {
    row.navigation_hint = null;
    return;
  }

  const titleSignal = getTitleSignal(row.section_title, queryTokens, normalizedQuery);
  const parentSignal = getTitleSignal(row.parent_section_title, queryTokens, normalizedQuery);
  const depth = getSectionDepth(row);
  const shallowBoost = Math.max(0, 6 - depth) * 0.015;
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

  row.rank_exactness = titleSignal.exact ? 1 : 0;
  row.rank_title_coverage = titleSignal.coverage;
  row.rank_parent_anchor = parentSignal.exact && (titleSignal.generic || titleSignal.coverage < 0.75) ? 1 : 0;
  row.rank_generic_penalty = titleSignal.generic ? 1 : 0;
  row.rank_depth = depth;
  row.navigation_hint = buildNavigationHint(row, titleSignal, parentSignal);
  row.score = Math.max(0, Math.min(1, row.score + structureDelta));
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
 * @returns {{ results: object[], mode: string, capabilities: object, page: number, maxResults: number, totalHits: number, warnings: string[], mode_requested: string, mode_actual: string, cached?: boolean }}
 */
export function hybridSearch(query, options = {}) {
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

  // Check cache first (skip for semantic/embeddings)
  if (useCache) {
    const cached = queryCache.get(query, { spec, page, mode });
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

  // Determine actual mode
  const hasVector = isVectorSearchAvailable() && !!embedQueryFn;
  let actualMode = mode;
  if (mode === 'auto') {
    actualMode = hasVector ? 'hybrid' : 'keyword';
  }
  if (actualMode === 'semantic' && !hasVector) {
    actualMode = 'keyword';
    warnings.push(`mode_degraded: requested=${mode} actual=${actualMode}`);
  }
  if (actualMode === 'hybrid' && !hasVector) {
    actualMode = 'keyword';
    warnings.push(`mode_degraded: requested=${mode} actual=${actualMode}`);
  }

  const capabilities = {
    keyword: true,
    semantic: hasVector,
  };

  // Execute searches
  let keywordResults = [];
  let semanticResults = [];

  if (actualMode !== 'semantic') {
    keywordResults = keywordSearch(parsed);
  }

  if ((actualMode === 'semantic' || actualMode === 'hybrid') && hasVector && embedQueryFn) {
    try {
      const queryVec = embedQueryFn(parsed.normalizedText);
      semanticResults = semanticSearch(queryVec, parsed.k * 3, parsed.specFilter);
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

  // Compute fused scores
  const effectiveAlpha = actualMode === 'keyword' ? 1.0 :
                         actualMode === 'semantic' ? 0.0 :
                         parsed.alpha;

  for (const [, row] of merged) {
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
  if (useCache) {
    queryCache.set(query, response, { spec, page, mode });
  }

  return response;
}

/**
 * Export cache for external monitoring/control
 */
export { queryCache, getQueryCacheStats } from './queryCache.js';
