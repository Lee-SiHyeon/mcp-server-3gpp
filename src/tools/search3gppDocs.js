import { hybridSearch } from '../search/hybridRanker.js';
import { initEmbedding, embedText } from '../embeddings/pipeline.js';
import { formatSuccess, formatError } from './helpers.js';

export const search3gppDocsSchema = {
  name: 'search_3gpp_docs',
  description: 'Search 3GPP specifications using keyword and/or semantic search. Supports quoted phrases, spec filtering, and Boolean operators. Returns ranked results biased toward the most relevant document/chapter anchors, with section references for follow-up retrieval via get_section.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (supports "phrases", spec:ts_24_301, -exclusions)' },
      spec: { type: 'string', description: 'Filter by spec ID (e.g., "ts_24_301")' },
      maxResults: { type: 'number', description: 'Max results (1-20, default: 5)' },
      page: { type: 'number', description: 'Page number (default: 1)' },
      mode: { type: 'string', enum: ['auto', 'keyword', 'semantic', 'hybrid'], description: 'Search mode (default: auto)' },
      includeScores: { type: 'boolean', description: 'Show relevance scores (default: false)' },
    },
    required: ['query'],
  },
};

let embeddingAvailability = 'unknown';
let embeddingInitPromise = null;

async function ensureEmbeddingReady() {
  if (embeddingAvailability === 'ready') return true;

  if (!embeddingInitPromise) {
    embeddingInitPromise = initEmbedding()
      .then(ready => {
        embeddingAvailability = ready ? 'ready' : 'unknown';
        return ready;
      })
      .catch(() => {
        embeddingAvailability = 'unknown';
        return false;
      })
      .finally(() => {
        embeddingInitPromise = null;
      });
  }

  return embeddingInitPromise;
}

async function embedQuery(text) {
  const ready = await ensureEmbeddingReady();
  if (!ready) return null;
  return embedText(text);
}

export async function handleSearch3gppDocs(args) {
  const { query, spec, maxResults = 5, page = 1, mode = 'auto', includeScores = false } = args;

  if (!query || !query.trim()) {
    return formatError('Query is required');
  }

  const clampedMax = Math.max(1, Math.min(20, maxResults));

  const result = await hybridSearch(query, {
    spec,
    maxResults: clampedMax,
    page: Math.max(1, page),
    mode,
    includeScores,
    embedQueryFn: mode === 'keyword' ? null : embedQuery,
  });

  return formatSuccess(result);
}
