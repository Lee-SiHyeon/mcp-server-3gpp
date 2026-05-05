/**
 * HyDE (Hypothetical Document Embeddings) query expansion.
 *
 * Uses an LLM to generate a hypothetical document that would answer the query,
 * then embeds that document for vector search. The insight: a generated answer
 * uses the same vocabulary as real documents, while a short query does not.
 *
 * This implementation uses NVIDIA's NIM API (nemotron-nano) as the default LLM,
 * but accepts any OpenAI-compatible chat completion endpoint.
 *
 * HyDE results are fused via RRF alongside keyword and direct-semantic results,
 * providing 5-15% recall improvement for short/vague queries.
 */

const DEFAULT_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/llama-3.1-nemotron-nano-8b-v1';
const DEFAULT_MAX_TOKENS = 200;
const DEFAULT_TEMPERATURE = 0.3;
const TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are a 3GPP telecommunications specification expert.
Given a search query, write a brief technical passage (2-4 sentences) that could
appear in a 3GPP specification document answering that query. Use formal 3GPP
terminology, section references where natural, and technical precision.
Do not prefix with labels like "Answer:" or "Response:".`;

let config = null;

export function configureHyde(options = {}) {
  config = {
    apiUrl: options.apiUrl || DEFAULT_API_URL,
    model: options.model || DEFAULT_MODEL,
    apiKey: options.apiKey || null,
    maxTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    enabled: options.enabled !== false,
    timeout: options.timeout || TIMEOUT_MS,
  };
}

export function isHydeEnabled() {
  return config?.enabled === true && Boolean(config?.apiKey);
}

export function getHydeConfig() {
  return config ? { ...config, apiKey: config.apiKey ? '***' : null } : null;
}

async function generateHypotheticalDocument(query) {
  if (!config?.apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`HyDE LLM error: HTTP ${response.status} ${text.slice(0, 200)}`);
      return null;
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('HyDE LLM timeout');
    } else {
      console.error(`HyDE LLM failed: ${e.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function expandQuery(query, embedQueryFn) {
  if (!isHydeEnabled()) {
    return { hypotheticalText: null, hypotheticalVector: null };
  }

  const hypotheticalText = await generateHypotheticalDocument(query);
  if (!hypotheticalText) {
    return { hypotheticalText: null, hypotheticalVector: null };
  }

  let hypotheticalVector = null;
  if (embedQueryFn) {
    try {
      hypotheticalVector = await embedQueryFn(hypotheticalText);
    } catch (e) {
      console.error(`HyDE embedding failed: ${e.message}`);
    }
  }

  return { hypotheticalText, hypotheticalVector };
}
