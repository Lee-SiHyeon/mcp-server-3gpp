/**
 * Serialize a Float32Array to a Buffer for SQLite BLOB storage.
 * @param {Float32Array} vector
 * @returns {Buffer}
 */
export function serializeVector(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserialize a Buffer back to Float32Array.
 * @param {Buffer} buffer
 * @returns {Float32Array}
 */
export function deserializeVector(buffer) {
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i];
  }
  return new Float32Array(ab);
}

/**
 * Validate vector dimensions.
 * @param {Float32Array} vector
 * @param {number} expectedDim
 * @returns {boolean}
 */
export function validateVector(vector, expectedDim = 384) {
  return vector instanceof Float32Array && vector.length === expectedDim;
}
