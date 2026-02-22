/** Shared utility functions used across download and popup pages. */

/**
 * Returns true if the URL looks like an HLS (.m3u8) or DASH (.mpd) stream.
 * Parses the URL so pathname and query string are both checked, catching
 * cases like `?file=video.m3u8`.  Falls back to a plain string check on
 * parse failure so relative URLs from content scripts also work.
 */
export function isStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const combined = (u.pathname + u.search).toLowerCase();
    return combined.includes('.m3u8') || combined.includes('.mpd');
  } catch {
    const lower = url.toLowerCase();
    return lower.includes('.m3u8') || lower.includes('.mpd');
  }
}

// Heuristic: path segments that look like tokens/UUIDs/hashes add no naming value.
// Matches: UUIDs, hex strings ≥16 chars, base64-ish strings ≥32 chars, JWT parts.
const TOKEN_RE = /^[0-9a-f]{16,}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

function isTokenLike(seg: string): boolean {
  return UUID_RE.test(seg) || TOKEN_RE.test(seg) || B64_RE.test(seg);
}

/**
 * Derive a safe filename from an M3U8/MPD URL.
 * Skips path segments that look like tokens/UUIDs, then takes up to two
 * meaningful segments, strips the .m3u8/.mpd extension, and replaces
 * unsafe characters.
 */
export function guessFilename(url: string): string {
  try {
    const path = new URL(url).pathname;
    const segments = path.split('/').filter(Boolean);
    // Filter out token-like segments, keeping the last meaningful ones
    const meaningful = segments.filter((s) => !isTokenLike(s));
    const parts = (meaningful.length > 0 ? meaningful : segments).slice(-2);
    return (
      parts
        .join('_')
        .replace(/\.(m3u8|mpd).*$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
        .slice(0, 60) || 'video'
    );
  } catch {
    return 'video';
  }
}

/** Format bytes-per-second into a human-readable speed string. */
export function formatSpeed(bps: number): string {
  if (bps <= 0) return '';
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
