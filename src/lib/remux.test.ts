/**
 * Unit tests for remux.ts (TS → MP4 via mux.js).
 * Run with: bun test
 *
 * Strategy: register a single mock.module with MockTransmuxer as the
 * stable Transmuxer class. Each test sets `behavior` before calling
 * remuxTsToMp4(). MockTransmuxer captures behavior in its constructor
 * so on/push/flush act accordingly.
 *
 * For the "noTransmuxer" scenario we throw from the constructor with the
 * same message remux.ts would produce — the observable behaviour
 * (Promise rejects with that message) is identical.
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test';

// ── Shared behavior state ─────────────────────────────────────────────

type Behavior =
  | { type: 'noTransmuxer' }
  | { type: 'error'; msg: string }
  | { type: 'empty' }
  | { type: 'throw' }
  | { type: 'success'; initData: Uint8Array; chunkData: Uint8Array };

let behavior: Behavior = { type: 'empty' };

// ── MockTransmuxer ────────────────────────────────────────────────────

class MockTransmuxer {
  private _b: Behavior;
  private _l: Record<string, (arg?: unknown) => void> = {};

  constructor() {
    this._b = behavior; // snapshot behavior at construction time
    // Simulate "no Transmuxer found" by throwing the same error message.
    // remux.ts wraps `new Transmuxer()` inside the Promise executor, so a
    // synchronous constructor throw causes the Promise to reject.
    if (this._b.type === 'noTransmuxer') {
      throw new Error('mux.js Transmuxer not found');
    }
  }

  on(event: string, cb: (arg?: unknown) => void) {
    this._l[event] = cb;
  }

  push(_data: Uint8Array) {
    if (this._b.type === 'throw') throw new Error('push failed');
  }

  flush() {
    const b = this._b;
    if (b.type === 'error') {
      this._l['error']?.(b.msg);
    } else if (b.type === 'empty') {
      this._l['data']?.({ initSegment: new Uint8Array(0), data: new Uint8Array(0) });
      this._l['done']?.();
    } else if (b.type === 'success') {
      this._l['data']?.({ initSegment: b.initData, data: b.chunkData });
      this._l['done']?.();
    }
  }

  dispose() {}
}

// ── Single stable mock.module registration ────────────────────────────
// mp4.Transmuxer always points to MockTransmuxer — behavior is driven
// entirely by the `behavior` variable read inside the constructor.

mock.module('mux.js', () => ({
  mp4: { Transmuxer: MockTransmuxer },
}));

// ── Import under test (one cached import shared across all tests) ──────

let remuxTsToMp4: (blob: Blob) => Promise<Blob>;

beforeAll(async () => {
  const mod = await import('./remux');
  remuxTsToMp4 = mod.remuxTsToMp4;
});

// ── Helper ────────────────────────────────────────────────────────────

function makeTsBlob(bytes = 188): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'video/mp2t' });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('remuxTsToMp4()', () => {
  it('throws when mux.js has no Transmuxer', async () => {
    behavior = { type: 'noTransmuxer' };
    await expect(remuxTsToMp4(makeTsBlob())).rejects.toThrow('mux.js Transmuxer not found');
  });

  it('rejects when transmuxer emits an error event', async () => {
    behavior = { type: 'error', msg: 'codec unsupported' };
    await expect(remuxTsToMp4(makeTsBlob())).rejects.toThrow('remux error: codec unsupported');
  });

  it('rejects with "remux output is empty" when no data is produced', async () => {
    behavior = { type: 'empty' };
    await expect(remuxTsToMp4(makeTsBlob())).rejects.toThrow('remux output is empty');
  });

  it('rejects when push() throws synchronously', async () => {
    behavior = { type: 'throw' };
    await expect(remuxTsToMp4(makeTsBlob())).rejects.toThrow('push failed');
  });

  it('resolves with an MP4 Blob containing init + chunk data', async () => {
    const initData = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70]);
    const chunkData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    behavior = { type: 'success', initData, chunkData };

    const result = await remuxTsToMp4(makeTsBlob());

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('video/mp4');
    // init (8 bytes) + chunk (4 bytes) = 12 bytes total
    expect(result.size).toBe(12);
  });

  it('omits init segment when its byteLength is 0', async () => {
    const emptyInit = new Uint8Array(0);
    const chunkData = new Uint8Array([0x01, 0x02]);
    behavior = { type: 'success', initData: emptyInit, chunkData };

    const result = await remuxTsToMp4(makeTsBlob());
    // Only chunk data, no init
    expect(result.size).toBe(2);
  });
});
