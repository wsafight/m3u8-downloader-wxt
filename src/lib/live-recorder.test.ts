import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import { LiveRecorder } from './live-recorder';

// ── Minimal HLS playlist fixtures ────────────────────────────────────────────

function mediaPlaylist(segs: string[], isEndList = true, targetDuration = 5): string {
  const body = segs.map((url, i) => `#EXTINF:${targetDuration}.0,\n${url}`).join('\n');
  return `#EXTM3U\n#EXT-X-TARGETDURATION:${targetDuration}\n${body}\n${isEndList ? '#EXT-X-ENDLIST' : ''}`;
}

// ── fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(responses: Array<{ ok: boolean; text?: string; status?: number }>) {
  let idx = 0;
  globalThis.fetch = mock(async (_url: string, _opts?: RequestInit) => {
    const r = responses[Math.min(idx++, responses.length - 1)];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      text: async () => r.text ?? '',
      arrayBuffer: async () => new ArrayBuffer(10),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LiveRecorder construction', () => {
  test('uses default options when none provided', () => {
    const rec = new LiveRecorder();
    expect(rec).toBeDefined();
  });

  test('accepts all options', () => {
    const rec = new LiveRecorder({
      concurrency: 4,
      retries: 2,
      onSegmentDone: () => {},
      onStatus: () => {},
    });
    expect(rec).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LiveRecorder.record – VOD (isEndList=true)', () => {
  test('records all segments and calls onSegmentDone for each', async () => {
    const segUrls = [
      'https://cdn.example.com/seg1.ts',
      'https://cdn.example.com/seg2.ts',
      'https://cdn.example.com/seg3.ts',
    ];
    const playlist = mediaPlaylist(segUrls, true);

    mockFetch([
      { ok: true, text: playlist }, // playlist fetch
      { ok: true }, // seg1
      { ok: true }, // seg2
      { ok: true }, // seg3
    ]);

    const segDoneCalls: number[] = [];
    const rec = new LiveRecorder({
      onSegmentDone: (count) => segDoneCalls.push(count),
    });

    await rec.record('https://cdn.example.com/index.m3u8');

    expect(segDoneCalls).toEqual([1, 2, 3]);
  });

  test('emits ok status on stream end', async () => {
    mockFetch([
      { ok: true, text: mediaPlaylist(['https://cdn.example.com/s.ts'], true) },
      { ok: true },
    ]);

    const statuses: Array<{ msg: string; type?: string }> = [];
    const rec = new LiveRecorder({
      onStatus: (msg, type) => statuses.push({ msg, type }),
    });

    await rec.record('https://cdn.example.com/index.m3u8');

    expect(statuses.some((s) => s.msg.includes('结束') && s.type === 'ok')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LiveRecorder.record – error handling', () => {
  test('emits error status on non-ok playlist fetch (does not throw)', async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1)
        return { ok: false, status: 500, text: async () => '' } as unknown as Response;
      // Second call returns VOD end to stop the loop
      return { ok: true, text: async () => mediaPlaylist([], true) } as unknown as Response;
    }) as unknown as typeof fetch;

    const errors: string[] = [];
    const rec = new LiveRecorder({
      onStatus: (msg, type) => {
        if (type === 'error') errors.push(msg);
      },
    });

    await rec.record('https://cdn.example.com/index.m3u8');

    expect(errors.some((e) => e.includes('HTTP 500'))).toBe(true);
  });

  test('emits error and skips segment on failed segment download', async () => {
    const playlist = mediaPlaylist(['https://cdn.example.com/fail.ts'], true);

    mockFetch([
      { ok: true, text: playlist }, // playlist
      { ok: false, status: 403 }, // seg – all retries fail
      { ok: false, status: 403 },
      { ok: false, status: 403 },
    ]);

    const errors: string[] = [];
    const rec = new LiveRecorder({
      retries: 3,
      onStatus: (msg, type) => {
        if (type === 'error') errors.push(msg);
      },
    });

    await rec.record('https://cdn.example.com/index.m3u8');

    expect(errors.some((e) => e.includes('HTTP 403'))).toBe(true);
  });

  test('deduplicates segments across playlist polls', async () => {
    const playlist = mediaPlaylist(['https://cdn.example.com/seg1.ts'], false);
    const endPlaylist = mediaPlaylist(['https://cdn.example.com/seg1.ts'], true);

    let pollCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('index.m3u8')) {
        pollCount++;
        return {
          ok: true,
          text: async () => (pollCount >= 2 ? endPlaylist : playlist),
        } as unknown as Response;
      }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Response;
    }) as unknown as typeof fetch;

    const segDoneCalls: number[] = [];
    const rec = new LiveRecorder({
      onSegmentDone: (count) => segDoneCalls.push(count),
    });

    await rec.record('https://cdn.example.com/index.m3u8');

    // seg1 should only be downloaded once despite appearing in two polls
    expect(segDoneCalls).toHaveLength(1);
    expect(segDoneCalls[0]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LiveRecorder.stop', () => {
  test('stop() aborts the recording loop', async () => {
    let fetchCount = 0;
    globalThis.fetch = mock(async (_url: string, opts?: RequestInit) => {
      fetchCount++;
      // On first playlist fetch, trigger stop
      if (fetchCount === 1) {
        return {
          ok: true,
          text: async () => mediaPlaylist([], false, 1), // live, no segs yet
        } as unknown as Response;
      }
      // Should not reach here if stop works
      throw new Error('should not fetch after stop');
    }) as unknown as typeof fetch;

    const rec = new LiveRecorder();

    // Stop immediately after starting
    const recordPromise = rec.record('https://cdn.example.com/index.m3u8');
    rec.stop();
    await recordPromise; // should resolve, not throw

    // Only one fetch should have occurred (the first playlist poll)
    expect(fetchCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LiveRecorder.saveAs', () => {
  test('returns segment count and byte size', async () => {
    const playlist = mediaPlaylist(
      ['https://cdn.example.com/s1.ts', 'https://cdn.example.com/s2.ts'],
      true,
    );

    mockFetch([
      { ok: true, text: playlist },
      { ok: true }, // s1
      { ok: true }, // s2
    ]);

    // Mock M3U8Downloader.saveBlob so we don't need chrome.downloads
    const { M3U8Downloader } = await import('./downloader');
    spyOn(M3U8Downloader.prototype, 'saveBlob').mockResolvedValue(undefined);

    const rec = new LiveRecorder();
    await rec.record('https://cdn.example.com/index.m3u8');
    const result = await rec.saveAs('test-recording');

    expect(result.segments).toBe(2);
    expect(result.bytes).toBeGreaterThan(0);
  });
});
