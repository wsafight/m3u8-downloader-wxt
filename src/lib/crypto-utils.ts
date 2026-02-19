/**
 * Shared AES-128 CBC decryption primitives used by both M3U8Downloader
 * and LiveRecorder. Keeping them as pure module-level functions makes
 * them independently testable and eliminates copy-pasted code.
 */

/**
 * Derive an AES-CBC IV from an HLS media-sequence number.
 * Per RFC 8216 §5.2 the sequence number is written as a 128-bit big-endian
 * integer, so it occupies the last 4 bytes of the 16-byte IV.
 */
export function seqToIV(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq >>> 0, false);
  return iv;
}

/**
 * Import a raw 16-byte key buffer as a non-extractable AES-CBC CryptoKey
 * suitable for decryption.
 */
export function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
}

/**
 * Decrypt an AES-128 CBC ciphertext buffer.
 *
 * @param data - Encrypted segment bytes (must be a multiple of 16 bytes).
 * @param key  - CryptoKey produced by `importAesKey`.
 * @param iv   - 16-byte initialisation vector.
 */
export function aesDecrypt(
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data);
}
