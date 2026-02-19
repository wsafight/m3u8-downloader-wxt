/**
 * Unit tests for segment-cache.ts (IndexedDB-backed segment persistence).
 * Run with: bun test
 *
 * Uses an in-memory IDB mock that mimics the subset of the API used by
 * the cache module (put, openCursor, IDBKeyRange.bound).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  cacheSegment,
  cacheTotalCount,
  loadCachedSegments,
  getCachedProgress,
  clearCachedSegments,
  cleanupStaleCaches,
} from './segment-cache';

// ── In-memory IDB mock ────────────────────────────────────────────

/** Single shared data store — reset in beforeEach. */
const mockData = new Map<string, unknown>();

function rangeFilter(key: string, range: IDBKeyRange | null): boolean {
  if (!range) return true;
  const r = range as unknown as { lower: string; upper: string; lowerOpen: boolean; upperOpen: boolean };
  const lo = r.lowerOpen ? key > r.lower : key >= r.lower;
  const hi = r.upperOpen ? key < r.upper : key <= r.upper;
  return lo && hi;
}

function makeMockObjectStore(): IDBObjectStore {
  return {
    put(value: unknown, key: IDBValidKey) {
      mockData.set(key as string, value);
      const req = { onsuccess: null as (() => void) | null, onerror: null } as unknown as IDBRequest;
      queueMicrotask(() => (req as any).onsuccess?.());
      return req;
    },
    delete(keyOrRange: IDBValidKey | IDBKeyRange) {
      // Support both single-key and key-range deletion (used by clearCachedSegments).
      const r = keyOrRange as unknown as { lower?: string; upper?: string; lowerOpen?: boolean; upperOpen?: boolean };
      if (r.lower !== undefined) {
        for (const k of [...mockData.keys()]) {
          if (rangeFilter(k, keyOrRange as IDBKeyRange)) mockData.delete(k);
        }
      } else {
        mockData.delete(keyOrRange as string);
      }
      const req = { onsuccess: null as (() => void) | null, onerror: null } as unknown as IDBRequest;
      queueMicrotask(() => (req as any).onsuccess?.());
      return req;
    },
    openCursor(range?: IDBKeyRange | null) {
      const entries = [...mockData.entries()]
        .filter(([k]) => rangeFilter(k, range ?? null))
        .sort(([a], [b]) => a.localeCompare(b));
      let idx = 0;
      const req = {
        result: undefined as unknown,
        onsuccess: null as (() => void) | null,
        onerror: null,
      } as unknown as IDBRequest;

      function advance() {
        if (idx >= entries.length) {
          (req as any).result = null;
          (req as any).onsuccess?.();
        } else {
          const [key, value] = entries[idx++];
          (req as any).result = {
            key,
            value,
            continue() { queueMicrotask(advance); },
            delete() { mockData.delete(key); },
          };
          (req as any).onsuccess?.();
        }
      }
      queueMicrotask(advance);
      return req;
    },
  } as unknown as IDBObjectStore;
}

function makeMockTransaction(): IDBTransaction {
  const store = makeMockObjectStore();
  const tx = {
    objectStore: () => store,
    oncomplete: null as (() => void) | null,
    onerror: null,
    error: null,
  } as unknown as IDBTransaction;
  // Auto-complete after all microtasks from put/cursor settle
  setTimeout(() => (tx as any).oncomplete?.(), 0);
  return tx;
}

function makeMockDb(): IDBDatabase {
  return {
    transaction: (_store: string, _mode: string) => makeMockTransaction(),
  } as unknown as IDBDatabase;
}

// Persistent mock DB (module caches the promise, so we reuse the same object)
const mockDb = makeMockDb();

function setupIdbMock() {
  globalThis.indexedDB = {
    open(_name: string, _version: number) {
      const req = {
        result: mockDb,
        onupgradeneeded: null,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null,
      };
      queueMicrotask(() => (req as any).onsuccess?.({ target: req }));
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  globalThis.IDBKeyRange = {
    bound(lower: string, upper: string, lowerOpen = false, upperOpen = false) {
      return { lower, upper, lowerOpen, upperOpen } as unknown as IDBKeyRange;
    },
  } as unknown as typeof IDBKeyRange;
}

// ── Setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockData.clear();
  setupIdbMock();
});

// ── Tests ─────────────────────────────────────────────────────────

describe('cacheSegment()', () => {
  it('persists a segment buffer under the correct key', async () => {
    const buf = new ArrayBuffer(64);
    await cacheSegment('https://cdn.example.com/video.m3u8', 3, buf);
    expect(mockData.get('https://cdn.example.com/video.m3u8:3')).toBe(buf);
  });

  it('overwrites an existing segment with new data', async () => {
    const buf1 = new ArrayBuffer(10);
    const buf2 = new ArrayBuffer(20);
    await cacheSegment('key', 0, buf1);
    await cacheSegment('key', 0, buf2);
    expect(mockData.get('key:0')).toBe(buf2);
  });
});

describe('cacheTotalCount()', () => {
  it('stores a meta entry with total and createdAt', async () => {
    const before = Date.now();
    await cacheTotalCount('mykey', 50);
    const meta = mockData.get('mykey:__meta__') as { total: number; createdAt: number };
    expect(meta.total).toBe(50);
    expect(meta.createdAt).toBeGreaterThanOrEqual(before);
    expect(meta.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('overwrites existing meta', async () => {
    await cacheTotalCount('mykey', 10);
    await cacheTotalCount('mykey', 99);
    const meta = mockData.get('mykey:__meta__') as { total: number };
    expect(meta.total).toBe(99);
  });
});

describe('loadCachedSegments()', () => {
  it('returns empty map when no segments are cached', async () => {
    const result = await loadCachedSegments('empty-key', 10);
    expect(result.size).toBe(0);
  });

  it('returns empty map when total is 0', async () => {
    mockData.set('mykey:0', new ArrayBuffer(8));
    const result = await loadCachedSegments('mykey', 0);
    expect(result.size).toBe(0);
  });

  it('loads cached segments by index', async () => {
    const buf0 = new ArrayBuffer(8);
    const buf2 = new ArrayBuffer(16);
    mockData.set('testkey:0', buf0);
    mockData.set('testkey:2', buf2);
    mockData.set('testkey:__meta__', { total: 5, createdAt: Date.now() });

    const result = await loadCachedSegments('testkey', 5);
    expect(result.size).toBe(2);
    expect(result.get(0)).toBe(buf0);
    expect(result.get(2)).toBe(buf2);
  });

  it('skips the meta entry', async () => {
    mockData.set('k:0', new ArrayBuffer(4));
    mockData.set('k:__meta__', { total: 3, createdAt: Date.now() });
    const result = await loadCachedSegments('k', 3);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it('skips entries whose value is not an ArrayBuffer', async () => {
    mockData.set('k:0', new ArrayBuffer(4));
    mockData.set('k:1', 'not-a-buffer');
    const result = await loadCachedSegments('k', 3);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it('does not load segments from a different cache key', async () => {
    mockData.set('keyA:0', new ArrayBuffer(4));
    mockData.set('keyB:0', new ArrayBuffer(8));
    const result = await loadCachedSegments('keyA', 5);
    expect(result.size).toBe(1);
    expect(result.get(0)?.byteLength).toBe(4);
  });
});

describe('getCachedProgress()', () => {
  it('returns 0/0 when cache is empty', async () => {
    const { count, total } = await getCachedProgress('empty');
    expect(count).toBe(0);
    expect(total).toBe(0);
  });

  it('counts segment entries and reads total from meta', async () => {
    mockData.set('vid:0', new ArrayBuffer(1));
    mockData.set('vid:1', new ArrayBuffer(1));
    mockData.set('vid:__meta__', { total: 10, createdAt: Date.now() });
    const { count, total } = await getCachedProgress('vid');
    expect(count).toBe(2);
    expect(total).toBe(10);
  });

  it('returns total 0 when meta is missing', async () => {
    mockData.set('vid:0', new ArrayBuffer(1));
    const { count, total } = await getCachedProgress('vid');
    expect(count).toBe(1);
    expect(total).toBe(0);
  });
});

describe('clearCachedSegments()', () => {
  it('removes all entries for the given key', async () => {
    mockData.set('del:0', new ArrayBuffer(1));
    mockData.set('del:1', new ArrayBuffer(1));
    mockData.set('del:__meta__', { total: 2, createdAt: Date.now() });
    mockData.set('other:0', new ArrayBuffer(1));

    await clearCachedSegments('del');

    expect(mockData.has('del:0')).toBe(false);
    expect(mockData.has('del:1')).toBe(false);
    expect(mockData.has('del:__meta__')).toBe(false);
    // unrelated key must survive
    expect(mockData.has('other:0')).toBe(true);
  });

  it('does nothing when key has no entries', async () => {
    mockData.set('safe:0', new ArrayBuffer(1));
    await clearCachedSegments('nonexistent');
    expect(mockData.has('safe:0')).toBe(true);
  });
});

describe('cleanupStaleCaches()', () => {
  it('removes caches older than maxAgeDays', async () => {
    const old = Date.now() - 8 * 86_400_000; // 8 days ago
    mockData.set('old:__meta__', { total: 5, createdAt: old });
    mockData.set('old:0', new ArrayBuffer(1));
    mockData.set('old:1', new ArrayBuffer(1));

    await cleanupStaleCaches(7);

    expect(mockData.has('old:0')).toBe(false);
    expect(mockData.has('old:1')).toBe(false);
    expect(mockData.has('old:__meta__')).toBe(false);
  });

  it('keeps caches newer than maxAgeDays', async () => {
    const recent = Date.now() - 1 * 86_400_000; // 1 day ago
    mockData.set('new:__meta__', { total: 3, createdAt: recent });
    mockData.set('new:0', new ArrayBuffer(1));

    await cleanupStaleCaches(7);

    expect(mockData.has('new:0')).toBe(true);
    expect(mockData.has('new:__meta__')).toBe(true);
  });

  it('does not throw when storage is unavailable', async () => {
    // Override to simulate a broken IDB
    globalThis.indexedDB = {
      open() {
        const req = { onerror: null as (() => void) | null, onsuccess: null, onupgradeneeded: null };
        queueMicrotask(() => (req as any).onerror?.(new Event('error')));
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    await expect(cleanupStaleCaches()).resolves.toBeUndefined();
  });
});
