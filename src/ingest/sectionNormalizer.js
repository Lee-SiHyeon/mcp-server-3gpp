/**
 * Section and spec normalization utilities.
 *
 * Canonical spec ID format: lowercase, dots→underscores, no version suffix.
 * E.g., "TS 24.301" → "ts_24_301"
 */

/**
 * Normalize a spec title / filename to canonical ID.
 *
 * Handles common shapes:
 *   "TS 24.301"                → "ts_24_301"
 *   "ts_124301"                → "ts_24_301"
 *   "ts_124301_v18.9.0_LTE_NAS" → "ts_24_301"
 *   "tr_137901_15.01.00"       → "tr_37_901"
 *   "ts_134123-1_v15-08-00"    → "ts_34_123_1"
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSpecId(raw) {
  if (!raw || typeof raw !== 'string') return 'unknown';

  let s = raw.trim().toLowerCase();

  // Strip version suffixes: _v18.9.0..., _15.01.00, _v19.00.00 and tags like _LTE_NAS, _2G3G_NAS, _5G_NAS
  s = s.replace(/_v?\d+[\.\-]\d+[\.\-]\d+.*$/, '');
  // Also strip trailing tags that start with underscore + uppercase-ish descriptors (already lowered)
  s = s.replace(/_(2g3g|5g|lte|umts)_.+$/, '');

  // "TS 24.301" / "TR 37.901" with space and dots
  const dotted = s.match(/^(ts|tr)\s+(\d+)\.(\d+)(?:[-.](\d+))?$/);
  if (dotted) {
    const parts = [dotted[1], dotted[2], dotted[3]];
    if (dotted[4]) parts.push(dotted[4]);
    return parts.join('_');
  }

  // Already underscored: ts_124301, tr_137901, ts_134123-1
  // 3GPP uses 6-digit numbering: 1XXYYZ → XX.YYZ (series XX, doc YYZ)
  // e.g., 124301 → series 24, doc 301; 137901 → series 37, doc 901
  const underscored = s.match(/^(ts|tr)_(\d{6})(?:[-_](\d+))?$/);
  if (underscored) {
    const digits = underscored[2]; // e.g., "124301"
    const series = digits.substring(1, 3);  // "24"
    const doc = digits.substring(3);        // "301"
    const parts = [underscored[1], series, doc];
    if (underscored[3]) parts.push(underscored[3]);
    return parts.join('_');
  }

  // ts_136523-1 pattern (already partially normalized with hyphen sub-part)
  const hyphenPart = s.match(/^(ts|tr)_(\d{6})-(\d+)$/);
  if (hyphenPart) {
    const digits = hyphenPart[2];
    const series = digits.substring(1, 3);
    const doc = digits.substring(3);
    return [hyphenPart[1], series, doc, hyphenPart[3]].join('_');
  }

  // Already in canonical form like "ts_24_301" or "ts_24_301_1"
  const canonical = s.match(/^(ts|tr)_\d+_\d+(_\d+)?$/);
  if (canonical) return s;

  // ts_151010-1_... with version already stripped
  const residual = s.match(/^(ts|tr)_(\d{6})-(\d+)_.*/);
  if (residual) {
    const digits = residual[2];
    const series = digits.substring(1, 3);
    const doc = digits.substring(3);
    return [residual[1], series, doc, residual[3]].join('_');
  }

  // Fallback: replace dots, hyphens, spaces with underscores and deduplicate
  return s.replace(/[\.\-\s]+/g, '_').replace(/_+/g, '_').replace(/_$/, '');
}

/**
 * Clean section title: trim whitespace, remove filler dots, normalize spacing.
 *
 * @param {string} title
 * @returns {string}
 */
export function cleanSectionTitle(title) {
  if (!title || typeof title !== 'string') return '';

  let cleaned = title.trim();
  // Remove filler dots commonly found in TOC lines: "5.3.2  Overview .......... 42"
  cleaned = cleaned.replace(/\.{2,}\s*\d*\s*$/, '');
  // Collapse internal whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

/**
 * Derive parent section ID from a section ID.
 *
 * "ts_24_301:5.3.2" → "ts_24_301:5.3"
 * "ts_24_301:5"     → null  (top-level, no parent)
 * "ts_24_301:legacy_chunk_3" → null
 *
 * @param {string} sectionId
 * @returns {string | null}
 */
export function getParentSectionId(sectionId) {
  if (!sectionId || typeof sectionId !== 'string') return null;

  const colonIdx = sectionId.indexOf(':');
  if (colonIdx < 0) return null;

  const specPart = sectionId.substring(0, colonIdx);
  const sectionNumber = sectionId.substring(colonIdx + 1);

  const lastDot = sectionNumber.lastIndexOf('.');
  if (lastDot < 0) return null; // top-level like "5"

  const parentNumber = sectionNumber.substring(0, lastDot);
  return `${specPart}:${parentNumber}`;
}

/**
 * Calculate depth from section number.
 *
 * "5" → 0, "5.3" → 1, "5.3.2.1" → 3
 *
 * @param {string} sectionNumber
 * @returns {number}
 */
export function sectionDepth(sectionNumber) {
  if (!sectionNumber || typeof sectionNumber !== 'string') return 0;
  const dots = sectionNumber.split('.').length - 1;
  return dots;
}

/**
 * Generate a brief from content (first sentence, max ~180 chars).
 *
 * @param {string} content
 * @param {number} [maxLen=180]
 * @returns {string}
 */
export function generateBrief(content, maxLen = 180) {
  if (!content || typeof content !== 'string') return '';

  // Collapse whitespace
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;

  // Try to cut at first sentence boundary within maxLen
  const sentenceEnd = text.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < maxLen) {
    return text.substring(0, sentenceEnd + 1);
  }

  // Fall back to word boundary
  const truncated = text.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? truncated.substring(0, lastSpace) : truncated) + '…';
}
