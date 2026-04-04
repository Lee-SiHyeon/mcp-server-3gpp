/**
 * Local embedding pipeline using @xenova/transformers.
 *
 * This module lazily initializes the model on first use.
 * The model (all-MiniLM-L6-v2) produces 384-dimensional vectors.
 *
 * Note: Actual embedding generation requires @xenova/transformers
 * as an optional dependency. When unavailable, all functions
 * gracefully return null/false.
 */

let pipeline = null;
let modelReady = false;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Check if embedding pipeline is available.
 */
export function isEmbeddingAvailable() {
  return modelReady;
}

/**
 * Get embedding dimensions.
 */
export function getEmbeddingDim() {
  return EMBEDDING_DIM;
}

/**
 * Initialize the embedding pipeline.
 * @returns {Promise<boolean>} true if successful
 */
export async function initEmbedding() {
  if (modelReady) return true;

  try {
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
    modelReady = true;
    console.log(`Embedding model loaded: ${MODEL_NAME}`);
    return true;
  } catch (e) {
    console.warn(`Embedding not available: ${e.message}`);
    return false;
  }
}

/**
 * Embed a single text string.
 * @param {string} text - Text to embed
 * @returns {Promise<Float32Array|null>} 384-dim vector or null
 */
export async function embedText(text) {
  if (!modelReady || !pipeline) return null;

  const output = await pipeline(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Embed multiple texts in batch.
 * @param {string[]} texts - Array of texts to embed
 * @param {number} [batchSize=16] - Batch size
 * @returns {Promise<Float32Array[]>} Array of 384-dim vectors
 */
export async function embedBatch(texts, batchSize = 16) {
  if (!modelReady || !pipeline) return [];

  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const outputs = await Promise.all(batch.map(t => embedText(t)));
    results.push(...outputs);
  }
  return results;
}

/**
 * Create an embed function for synchronous-style use (wraps async).
 * For use with hybridRanker's embedQueryFn parameter.
 */
export function createSyncEmbedder() {
  if (!modelReady) return null;

  // Semantic search requires async flow — synchronous wrapper
  // is not feasible without top-level await or worker threads.
  return null;
}

export { MODEL_NAME, EMBEDDING_DIM };
