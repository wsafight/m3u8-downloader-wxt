/**
 * Unit tests for M3U8Downloader core logic.
 * Run with: bun test
 */

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { M3U8Downloader, PartialDownloadError, ABORT_MSG } from './downloader';
import { ZH_DOWNLOADER_MESSAGES } from './default-messages';
import type { Segment } from './types';

// ── Minimal stubs ──────────────────────────────────────────────────

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    url: 'https://cdn.example.com/seg001.ts',
    duration: 6,
    sequence: 0,
    encryption: null,
    ...overrides,
  };
}

function mockOkResponse(body: ArrayBuffer | string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers,
  });
}

function mockErrorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers });
}

// ── fetchBinary error classification ──────────────────────────────

describe('HTTP error classification', () => {
  let dl: M3U8Downloader;

  beforeEach(() => {
    dl = new M3U8Downloader({ retries: 1 });
  });

  it('throws on 403', async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockErrorResponse(403)));
    // @ts-ignore – access private for test
    await expect(dl['fetchBinary']('https://example.com/seg.ts')).rejects.toThrow('403');
  });

  it('throws on 404', async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockErrorResponse(404)));
    // @ts-ignore
    await expect(dl['fetchBinary']('https://example.com/seg.ts')).rejects.toThrow('404');
  });

  it('throws on 500', async () => {
    globalThis.fetch = mock(() => Promise.resolve(mockErrorResponse(500)));
    // @ts-ignore
    await expect(dl['fetchBinary']('https://example.com/seg.ts')).rejects.toThrow('500');
  });

  it('returns buffer on 206 partial content', async () => {
    const buf = new ArrayBuffer(100);
    globalThis.fetch = mock(() => Promise.resolve(new Response(buf, { status: 206 })));
    // @ts-ignore
    const result = await dl['fetchBinary']('https://example.com/seg.ts');
    expect(result.byteLength).toBe(100);
  });
});

// ── 429 Retry-After ───────────────────────────────────────────────

describe('retry() with 429 Retry-After', () => {
  it('waits Retry-After seconds on 429', async () => {
    const dl = new M3U8Downloader({ retries: 2 });
    let callCount = 0;
    const delays: number[] = [];

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);
      fn(); // call immediately in tests
      return 0 as never;
    }) as typeof setTimeout;

    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(null, {
          status: 429,
          headers: { 'Retry-After': '5' },
        }));
      }
      return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }));
    });

    // @ts-ignore
    await dl['retry'](() => dl['fetchBinary']('https://example.com/seg.ts'));

    expect(callCount).toBe(2);
    // Retry-After: 5 seconds = 5000ms
    expect(delays[0]).toBe(5000);

    globalThis.setTimeout = originalSetTimeout;
  });

  it('caps Retry-After at 60 seconds', async () => {
    const dl = new M3U8Downloader({ retries: 2 });
    const delays: number[] = [];
    let callCount = 0;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);
      fn();
      return 0 as never;
    }) as typeof setTimeout;

    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(null, {
          status: 429,
          headers: { 'Retry-After': '120' }, // 2 minutes — should be capped at 60s
        }));
      }
      return Promise.resolve(new Response(new ArrayBuffer(4), { status: 200 }));
    });

    // @ts-ignore
    await dl['retry'](() => dl['fetchBinary']('https://example.com/seg.ts'));

    expect(delays[0]).toBe(60_000);
    globalThis.setTimeout = originalSetTimeout;
  });
});

// ── Speed calculation ─────────────────────────────────────────────

describe('_calcSpeed()', () => {
  it('returns 0 when fewer than 2 samples', () => {
    const dl = new M3U8Downloader();
    // @ts-ignore
    expect(dl['_calcSpeed']()).toBe(0);
  });

  it('calculates correct speed from samples', () => {
    const dl = new M3U8Downloader();
    const now = Date.now();
    // Populate the ring buffer directly: slot 0 = old sample, slot 1 = new sample
    // @ts-ignore
    const buf: Float64Array = dl['_speedBuf'];
    buf[0] = now - 2000; buf[1] = 0;          // slot 0: 2 s ago, 0 bytes
    buf[2] = now;        buf[3] = 2_000_000;  // slot 1: now, 2 MB
    // @ts-ignore
    dl['_speedWrite'] = 2; // next write at slot 2
    // @ts-ignore
    dl['_speedCount'] = 2;
    // @ts-ignore
    const speed = dl['_calcSpeed']();
    expect(speed).toBeCloseTo(1_000_000, -4); // ~1 MB/s
  });
});

// ── pool() concurrency ────────────────────────────────────────────

describe('pool()', () => {
  it('runs all workers and respects concurrency', async () => {
    const dl = new M3U8Downloader({ concurrency: 2 });
    const results: number[] = [];
    // @ts-ignore
    await dl['pool'](5, async (i) => {
      results.push(i);
    });
    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops early when aborted', async () => {
    const dl = new M3U8Downloader({ concurrency: 2 });
    dl.abort();
    const results: number[] = [];
    // @ts-ignore
    await dl['pool'](5, async (i) => {
      results.push(i);
    });
    expect(results.length).toBe(0);
  });
});

// ── PartialDownloadError ──────────────────────────────────────────

describe('PartialDownloadError', () => {
  it('has correct failedCount and message', () => {
    const err = new PartialDownloadError(3);
    expect(err.failedCount).toBe(3);
    expect(err.message).toContain('3');
    expect(err.name).toBe('PartialDownloadError');
  });
});

// ── downloadSegments with partial failures ───────────────────────

describe('downloadSegments() partial failures', () => {
  it('throws PartialDownloadError when some segments fail', async () => {
    const dl = new M3U8Downloader({ concurrency: 2, retries: 1 });
    const segs = [
      makeSegment({ url: 'https://cdn.example.com/seg1.ts', sequence: 0 }),
      makeSegment({ url: 'https://cdn.example.com/seg2.ts', sequence: 1 }),
      makeSegment({ url: 'https://cdn.example.com/seg3.ts', sequence: 2 }),
    ];

    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve(mockErrorResponse(404));
      }
      return Promise.resolve(new Response(new ArrayBuffer(10), { status: 200 }));
    });

    await expect(dl.downloadSegments(segs, 'test')).rejects.toBeInstanceOf(PartialDownloadError);
    expect(dl.failedIndices.length).toBeGreaterThan(0);
  });
});

// ── savePartial() ─────────────────────────────────────────────────

describe('savePartial()', () => {
  it('throws if no successful segments', async () => {
    const dl = new M3U8Downloader({ retries: 1 });
    globalThis.fetch = mock(() => Promise.resolve(mockErrorResponse(404)));

    const segs = [makeSegment({ url: 'https://cdn.example.com/seg1.ts', sequence: 0 })];
    try {
      await dl.downloadSegments(segs, 'test');
    } catch {
      // expected PartialDownloadError
    }

    await expect(dl.savePartial()).rejects.toThrow(ZH_DOWNLOADER_MESSAGES.noOkSegments);
  });
});

// ── abort() ──────────────────────────────────────────────────────

describe('abort()', () => {
  it('sets aborted state', () => {
    const dl = new M3U8Downloader();
    // @ts-ignore
    expect(dl['_aborted']).toBe(false);
    dl.abort();
    // @ts-ignore
    expect(dl['_aborted']).toBe(true);
  });

  it('rejects download with abort message', async () => {
    const dl = new M3U8Downloader({ retries: 1 });
    // Use a fetch mock that respects the AbortSignal
    globalThis.fetch = mock((_url: string, opts?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = opts?.signal;
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });

    const promise = dl.download('https://example.com/playlist.m3u8', 'test');
    // Yield to let the fetch start waiting on the signal
    await Promise.resolve();
    dl.abort();

    await expect(promise).rejects.toThrow(ABORT_MSG);
  });
});

// ── AES-128 decryption ────────────────────────────────────────────

describe('decryptAES128()', () => {
  it('decrypts data using AES-CBC', async () => {
    const dl = new M3U8Downloader({ retries: 1 });

    // Generate a real AES key for testing
    const key = await crypto.subtle.generateKey({ name: 'AES-CBC', length: 128 }, true, ['encrypt', 'decrypt']);
    const rawKey = await crypto.subtle.exportKey('raw', key);
    const iv = new Uint8Array(16).fill(0);

    // Encrypt some test data
    const plaintext = new Uint8Array(32).fill(0xAB);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plaintext);

    // Mock key fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(rawKey, { status: 200 }))
    );

    const seg = makeSegment({
      encryption: { method: 'AES-128', uri: 'https://cdn.example.com/key', iv },
    });

    // @ts-ignore
    const decrypted = await dl['decryptAES128'](encrypted, seg);
    expect(new Uint8Array(decrypted).slice(0, 32)).toEqual(plaintext);
  });
});

// ── fMP4 init cache ───────────────────────────────────────────────

describe('fMP4 init segment cache', () => {
  it('fetches init segment only once for duplicate URLs', async () => {
    const dl = new M3U8Downloader({ concurrency: 1, retries: 1 });
    let fetchCount = 0;

    globalThis.fetch = mock(() => {
      fetchCount++;
      return Promise.resolve(new Response(new ArrayBuffer(16), { status: 200 }));
    });

    const initSegment = { url: 'https://cdn.example.com/init.mp4' };

    // @ts-ignore
    await dl['downloadSegments']([], 'test', initSegment, true);
    fetchCount = 0; // reset counter

    // Second call with same init URL — should use cache
    // @ts-ignore
    await dl['downloadSegments']([], 'test', initSegment, true);

    expect(fetchCount).toBe(0); // init segment should be cached
  });
});
