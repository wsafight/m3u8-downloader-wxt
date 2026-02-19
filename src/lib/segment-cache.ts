/**
 * IndexedDB-backed segment cache.
 *
 * Each successfully downloaded segment's ArrayBuffer is persisted under
 * `${cacheKey}:${index}`.  On resume the downloader restores these buffers
 * directly into its internal state, so only the *missing* segments are
 * re-downloaded and the merged output is always complete.
 *
 * A metadata entry `${cacheKey}:__meta__` stores { total, createdAt } so
 * the resume UI can show "N / M segments cached" before parsing the playlist,
 * and stale caches can be cleaned up automatically.
 */

const DB_NAME = 'm3u8dl_cache';
const STORE = 'segments';
const DB_VERSION = 1;

// ── Singleton DB connection ───────────────────────────────────────
// Reusing one connection avoids the overhead of open/close on every operation.
let _dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        _dbPromise = null; // allow retry on next call
        reject(req.error);
      };
    });
  }
  return _dbPromise;
}

/** Persist one segment buffer. Fire-and-forget safe (non-critical path). */
export async function cacheSegment(
  cacheKey: string,
  index: number,
  buffer: ArrayBuffer,
): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(buffer, `${cacheKey}:${index}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Store the total segment count and creation timestamp for progress display and GC. */
export async function cacheTotalCount(cacheKey: string, total: number): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ total, createdAt: Date.now() }, `${cacheKey}:__meta__`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Load all cached segments for a given key using a cursor scan.
 * Returns a Map<segmentIndex, ArrayBuffer> containing only the segments that
 * were previously persisted.
 */
export async function loadCachedSegments(
  cacheKey: string,
  total: number,
): Promise<Map<number, ArrayBuffer>> {
  if (total === 0) return new Map();
  const db = await getDb();
  const result = new Map<number, ArrayBuffer>();
  const prefix = `${cacheKey}:`;
  const metaKey = `${cacheKey}:__meta__`;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    // Use a key range to scan only entries belonging to this cacheKey
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    const req = tx.objectStore(STORE).openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = cursor.key as string;
      if (key !== metaKey) {
        const idxStr = key.slice(prefix.length);
        const idx = parseInt(idxStr);
        if (!isNaN(idx) && cursor.value instanceof ArrayBuffer) {
          result.set(idx, cursor.value);
        }
      }
      cursor.continue();
    };
    req.onerror = () => resolve();
  });

  return result;
}

/**
 * How many segments are cached for a given URL (for the resume prompt).
 * Returns `{ count, total }` where total is 0 if unknown.
 */
export async function getCachedProgress(
  cacheKey: string,
): Promise<{ count: number; total: number }> {
  const db = await getDb();
  let count = 0;
  let total = 0;
  const prefix = `${cacheKey}:`;
  const metaKey = `${cacheKey}:__meta__`;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    const req = tx.objectStore(STORE).openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = cursor.key as string;
      if (key === metaKey) {
        const meta = cursor.value as { total: number; createdAt: number };
        total = meta?.total ?? 0;
      } else {
        count++;
      }
      cursor.continue();
    };
    req.onerror = () => resolve();
  });

  return { count, total };
}

/** Remove all cached entries for the given key after a successful merge. */
export async function clearCachedSegments(cacheKey: string): Promise<void> {
  const db = await getDb();
  const prefix = `${cacheKey}:`;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    const req = store.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove caches older than `maxAgeDays` days.
 * Safe to call at startup; errors are swallowed silently.
 */
export async function cleanupStaleCaches(maxAgeDays = 7): Promise<void> {
  try {
    const db = await getDb();
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    // Collect stale cacheKey prefixes by scanning __meta__ entries
    const staleKeys: string[] = [];

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const key = cursor.key as string;
        if (key.endsWith(':__meta__')) {
          const meta = cursor.value as { total: number; createdAt: number } | undefined;
          if (meta?.createdAt != null && meta.createdAt < cutoff) {
            staleKeys.push(key.slice(0, -'__meta__'.length));
          }
        }
        cursor.continue();
      };
      req.onerror = () => resolve();
    });

    for (const prefix of staleKeys) {
      await clearCachedSegments(prefix.slice(0, -1)); // strip trailing ':'
    }
  } catch {
    // Best-effort cleanup; never throw
  }
}
