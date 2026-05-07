/**
 * Cross-encoder reranker for search result refinement.
 * Supports Jina Rerank API. Disabled by default.
 * Enable via: configureReranker({ apiKey: 'jina_xxx' })
 */

const DEFAULT_API_URL = 'https://api.jina.ai/v1/rerank';
const DEFAULT_MODEL = 'jina-reranker-v2-base-multilingual';
const DEFAULT_TOP_N = 50;
const TIMEOUT_MS = 5000;
const MAX_CANDIDATES = 50;

let config = null;

export function configureReranker(options = {}) {
  config = {
    apiUrl: options.apiUrl || DEFAULT_API_URL,
    model: options.model || DEFAULT_MODEL,
    apiKey: options.apiKey || null,
    topN: options.topN || DEFAULT_TOP_N,
    timeout: options.timeout || TIMEOUT_MS,
    enabled: options.enabled !== false,
  };
}

export function isRerankerEnabled() {
  return config?.enabled === true && Boolean(config?.apiKey);
}

export function getRerankerConfig() {
  return config ? { ...config, apiKey: config.apiKey ? '***' : null } : null;
}

async function callJinaRerank(query, documents, topN) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: config.model, query, documents, top_n: topN, return_documents: false }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`Reranker API error: HTTP ${response.status} ${text.slice(0, 200)}`);
      return null;
    }
    const json = await response.json();
    return json.results || [];
  } catch (e) {
    if (e.name === 'AbortError') console.error('Reranker API timeout');
    else console.error(`Reranker API failed: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function rerankCandidates(query, candidates, options = {}) {
  const { topN = candidates.length } = options;
  if (!isRerankerEnabled() || candidates.length === 0) return candidates;

  const capped = candidates.slice(0, MAX_CANDIDATES);
  const documents = capped.map(row => {
    const parts = [];
    if (row.section_title) parts.push(row.section_title);
    if (row.snippet) parts.push(row.snippet);
    return parts.join(' — ') || '(empty)';
  });

  const results = await callJinaRerank(query, documents, Math.min(topN, capped.length));
  if (!results || results.length === 0) return candidates;

  let maxScore = 0;
  for (const r of results) { if (r.relevance_score > maxScore) maxScore = r.relevance_score; }

  const scoreMap = new Map();
  for (const r of results) {
    const normalized = maxScore > 0 ? r.relevance_score / maxScore : 0;
    scoreMap.set(r.index, Math.max(0, Math.min(1, normalized)));
  }

  for (let i = 0; i < capped.length; i++) {
    if (scoreMap.has(i)) capped[i].reranker_score = scoreMap.get(i);
  }
  return capped;
}
