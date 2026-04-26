/**
 * Response formatting helpers — centralises the MCP content envelope
 * so tool handlers don't repeat the same JSON-wrapping boilerplate.
 */

/**
 * Wrap a success payload in the MCP content format.
 * @param {*} data — JSON-serialisable payload
 * @returns {{ content: Array<{type: string, text: string}> }}
 */
export function formatSuccess(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Wrap an error in the MCP content format.
 * @param {string|object} errorMessage — either a string or a pre-built error object
 * @param {object} [details] — extra fields merged into the error object
 * @returns {{ content: Array<{type: string, text: string}>, isError: boolean }}
 */
export function formatError(errorMessage, details) {
  const errorObj = typeof errorMessage === 'string'
    ? { error: errorMessage, ...(details || {}) }
    : errorMessage;
  return {
    content: [{ type: 'text', text: JSON.stringify(errorObj) }],
    isError: true,
  };
}

/**
 * Wrap a Zod validation failure in MCP content format with isError flag.
 * @param {object} validationResult — the { error, details } object from validateArgs
 * @returns {{ content: Array<{type: string, text: string}>, isError: boolean }}
 */
export function formatValidationError(validationResult) {
  return {
    content: [{ type: 'text', text: JSON.stringify(validationResult) }],
    isError: true,
  };
}

/**
 * Build a composite sectionId from specId + sectionNumber when the caller
 * supplies the pair instead of a pre-built ID.
 * @param {object} args
 * @returns {string|undefined}
 */
export function resolveSectionId(args) {
  let { sectionId, specId, sectionNumber } = args;
  if (!sectionId && specId && sectionNumber) {
    sectionId = `${specId}:${sectionNumber}`;
  }
  return sectionId;
}
