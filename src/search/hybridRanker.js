import { parseQuery } from './queryParser.js';
import { keywordSearch } from './keywordSearch.js';
import { semanticSearch, isVectorSearchAvailable } from './semanticSearch.js';

/**
 * Perform hybrid keyword + semantic search with fusion scoring.
 *
 * score = α * keyword_score + (1-α) * semantic_score
 * Default α = 0.4 (favors semantic rescue while rewarding exact terms)
 *
 * @param {string} query - Raw search query
 * @param {object} [options] - { spec, maxResults, page, mode, alpha, includeScores, embedQueryFn }
 * @returns {{ results: object[], mode: string, capabilities: object, page: number, maxResults: number, totalHits: number }}
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
  } = options;

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
  }
  if (actualMode === 'hybrid' && !hasVector) {
    actualMode = 'keyword';
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

    row.score = Math.max(0, Math.min(1, row.score));
  }

  // Sort by score descending
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);

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

    if (includeScores) {
      result.score = Math.round(row.score * 1000) / 1000;
      result.keyword_score = Math.round(row.keyword_score * 1000) / 1000;
      result.semantic_score = Math.round(row.semantic_score * 1000) / 1000;
      result.evidence = row.evidence;
    }

    return result;
  });

  return {
    mode: actualMode,
    page,
    maxResults,
    totalHits: ranked.length,
    capabilities,
    results,
  };
}
