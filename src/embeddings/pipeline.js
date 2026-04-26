let pipeline = null;
let modelReady = false;
let transformersPackageName = null;
let initPromise = null;

const MODEL_NAME = 'Xenova/multilingual-e5-small';
const UPSTREAM_MODEL_NAME = 'intfloat/multilingual-e5-small';
const EMBEDDING_DIM = 384;
const QUERY_PREFIX = 'query:';
const PASSAGE_PREFIX = 'passage:';
const PREFIX_POLICY_VERSION = 'multilingual-e5-small-prefix-v1';
const EMBEDDING_POLICY_VERSION = 'multilingual-e5-small-policy-v1';
const TRANSFORMERS_PACKAGES = ['@huggingface/transformers', '@xenova/transformers'];

function normalizeEmbeddingText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEmbeddingPrefix(text) {
  return text.replace(/^(query|passage):\s*/i, '');
}

function formatPrefixedText(prefix, text) {
  const normalized = normalizeEmbeddingText(text);
  if (!normalized) return prefix;
  const unprefixed = stripEmbeddingPrefix(normalized);
  return `${prefix} ${unprefixed}`.trim();
}

function coerceEmbeddingOutput(output) {
  if (output?.data instanceof Float32Array) {
    return output.data;
  }

  if (Array.isArray(output?.data)) {
    return Float32Array.from(output.data);
  }

  if (output instanceof Float32Array) {
    return output;
  }

  if (Array.isArray(output)) {
    return Float32Array.from(output);
  }

  throw new Error('Embedding pipeline returned an unsupported output shape');
}

function coerceBatchEmbeddingOutput(output) {
  const flat = coerceEmbeddingOutput(output);
  const dims = output?.dims;

  if (!Array.isArray(dims) || dims.length !== 2 || dims[1] !== EMBEDDING_DIM) {
    if (flat.length === EMBEDDING_DIM) {
      return [flat];
    }

    throw new Error(`Unexpected batch embedding shape: ${JSON.stringify(dims ?? null)}`);
  }

  const [batchSize, dim] = dims;
  const vectors = [];
  for (let i = 0; i < batchSize; i += 1) {
    const start = i * dim;
    const end = start + dim;
    vectors.push(flat.slice(start, end));
  }

  return vectors;
}

async function loadTransformersPipeline() {
  let lastError = null;

  for (const packageName of TRANSFORMERS_PACKAGES) {
    try {
      const mod = await import(packageName);
      transformersPackageName = packageName;
      return mod.pipeline;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No compatible transformers package was found');
}

export function isEmbeddingAvailable() {
  return modelReady;
}

export function getEmbeddingDim() {
  return EMBEDDING_DIM;
}

export function getEmbeddingRuntimeInfo() {
  return {
    modelName: MODEL_NAME,
    upstreamModelName: UPSTREAM_MODEL_NAME,
    embeddingDim: EMBEDDING_DIM,
    queryPrefix: QUERY_PREFIX,
    passagePrefix: PASSAGE_PREFIX,
    prefixPolicyVersion: PREFIX_POLICY_VERSION,
    policyVersion: EMBEDDING_POLICY_VERSION,
    transformersPackageName,
    available: modelReady,
  };
}

export function formatQueryText(text) {
  return formatPrefixedText(QUERY_PREFIX, text);
}

export function formatPassageText(text) {
  return formatPrefixedText(PASSAGE_PREFIX, text);
}

export async function initEmbedding() {
  if (modelReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const createPipeline = await loadTransformersPipeline();
      pipeline = await createPipeline('feature-extraction', MODEL_NAME, {
        quantized: true,
      });
      modelReady = true;
      console.log(`Embedding model loaded: ${MODEL_NAME}`);
      return true;
    } catch (error) {
      pipeline = null;
      modelReady = false;
      transformersPackageName = null;
      console.warn(`Embedding not available: ${error.message}`);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function embedText(text, options = {}) {
  const { kind = 'query' } = options;
  if (!modelReady || !pipeline) return null;

  const formatted = kind === 'passage'
    ? formatPassageText(text)
    : formatQueryText(text);

  const output = await pipeline(formatted, { pooling: 'mean', normalize: true });
  const vector = coerceEmbeddingOutput(output);

  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${vector.length}`);
  }

  return vector;
}

export async function embedBatch(texts, options = {}) {
  const {
    kind = 'query',
    batchSize = 16,
  } = options;

  if (!modelReady || !pipeline) return [];

  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const formattedBatch = batch.map((text) => (
      kind === 'passage' ? formatPassageText(text) : formatQueryText(text)
    ));
    const output = await pipeline(formattedBatch, { pooling: 'mean', normalize: true });
    const vectors = coerceBatchEmbeddingOutput(output);

    if (vectors.length !== batch.length) {
      throw new Error(`Embedding batch mismatch: expected ${batch.length}, got ${vectors.length}`);
    }

    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIM) {
        throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${vector.length}`);
      }
      results.push(vector);
    }
  }

  return results;
}

export function createSyncEmbedder() {
  if (!modelReady) return null;
  return null;
}

export {
  MODEL_NAME,
  UPSTREAM_MODEL_NAME,
  EMBEDDING_DIM,
  QUERY_PREFIX,
  PASSAGE_PREFIX,
  PREFIX_POLICY_VERSION,
  EMBEDDING_POLICY_VERSION,
  TRANSFORMERS_PACKAGES,
  normalizeEmbeddingText,
};
