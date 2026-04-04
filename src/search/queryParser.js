/**
 * Parse a search query into structured form.
 *
 * Supports:
 * - Quoted phrases: "attach reject"
 * - Spec filter: spec:ts_24_301
 * - Section ref: section:5.5.1
 * - OR operator: attach OR detach
 * - NOT operator: -rejected or NOT rejected
 * - Plain text (default AND semantics)
 *
 * @param {string} query - Raw query string
 * @param {object} [options] - { alpha, k, mode, specFilter }
 * @returns {{ raw: string, normalizedText: string, phrases: string[], specFilter: string|null, sectionRef: string|null, terms: string[], negatedTerms: string[], enableKeyword: boolean, enableSemantic: boolean, alpha: number, k: number }}
 */
export function parseQuery(query, options = {}) {
  const result = {
    raw: query,
    normalizedText: '',
    phrases: [],
    terms: [],
    negatedTerms: [],
    specFilter: options.specFilter || null,
    sectionRef: null,
    enableKeyword: true,
    enableSemantic: options.mode !== 'keyword',
    alpha: options.alpha ?? 0.4,
    k: options.k ?? 10,
  };

  let text = query.trim();

  // Extract spec:xxx filter
  const specMatch = text.match(/spec:(\S+)/i);
  if (specMatch) {
    result.specFilter = specMatch[1].toLowerCase();
    text = text.replace(specMatch[0], '').trim();
  }

  // Extract section:xxx reference
  const sectionMatch = text.match(/section:(\S+)/i);
  if (sectionMatch) {
    result.sectionRef = sectionMatch[1];
    text = text.replace(sectionMatch[0], '').trim();
  }

  // Extract quoted phrases
  const phraseRe = /"([^"]+)"/g;
  let m;
  while ((m = phraseRe.exec(text)) !== null) {
    result.phrases.push(m[1]);
  }
  text = text.replace(phraseRe, '').trim();

  // Handle NOT/negation
  const words = text.split(/\s+/).filter(Boolean);
  let skipNext = false;
  for (let i = 0; i < words.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    const w = words[i];
    if (w === 'OR') continue; // OR is implicit in FTS5
    if (w === 'NOT' && i + 1 < words.length) {
      result.negatedTerms.push(words[i + 1].toLowerCase());
      skipNext = true;
    } else if (w.startsWith('-')) {
      result.negatedTerms.push(w.slice(1).toLowerCase());
    } else {
      result.terms.push(w);
    }
  }

  result.normalizedText = [...result.phrases, ...result.terms].join(' ');

  // Mode overrides
  if (options.mode === 'keyword') {
    result.enableSemantic = false;
  } else if (options.mode === 'semantic') {
    result.enableKeyword = false;
  }

  return result;
}
