/**
 * Unit tests for settings.ts (chrome.storage.sync persistence).
 * Run with: bun test
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { loadSettings, saveSettings, resetSettings } from './settings';

// ── chrome.storage.sync mock ───────────────────────────────────────

let _syncStore: Record<string, unknown> = {};

function setupChromeMock() {
  globalThis.chrome = {
    storage: {
      sync: {
        get: (keys: string[] | Record<string, unknown>) => {
          const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const k of keyList) {
            if (k in _syncStore) result[k] = _syncStore[k];
          }
          return Promise.resolve(result);
        },
        set: (values: Record<string, unknown>) => {
          Object.assign(_syncStore, values);
          return Promise.resolve();
        },
      },
    },
  } as unknown as typeof chrome;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('loadSettings()', () => {
  beforeEach(() => {
    _syncStore = {};
    setupChromeMock();
  });

  it('returns defaults when storage is empty', async () => {
    const s = await loadSettings();
    expect(s.concurrency).toBe(6);
    expect(s.convertToMp4).toBe(false);
    expect(s.language).toBe('zh');
    expect(s.retries).toBe(3);
    expect(s.autoEnqueue).toBe(false);
  });

  it('merges stored values over defaults', async () => {
    _syncStore = { concurrency: 12, language: 'en' };
    const s = await loadSettings();
    expect(s.concurrency).toBe(12);
    expect(s.language).toBe('en');
    // other keys still use defaults
    expect(s.convertToMp4).toBe(false);
    expect(s.retries).toBe(3);
  });

  it('preserves preferredResolution if stored', async () => {
    _syncStore = { preferredResolution: '1080p' };
    const s = await loadSettings();
    expect(s.preferredResolution).toBe('1080p');
  });

  it('returns all required fields even when storage has unknown keys', async () => {
    _syncStore = { unknownKey: 'foo', concurrency: 4 };
    const s = await loadSettings();
    expect(s.concurrency).toBe(4);
    expect(s.retries).toBe(3);
  });
});

describe('saveSettings()', () => {
  beforeEach(() => {
    _syncStore = {};
    setupChromeMock();
  });

  it('writes a single field', async () => {
    await saveSettings({ concurrency: 8 });
    expect(_syncStore.concurrency).toBe(8);
  });

  it('writes multiple fields at once', async () => {
    await saveSettings({ concurrency: 10, language: 'en', convertToMp4: true });
    expect(_syncStore.concurrency).toBe(10);
    expect(_syncStore.language).toBe('en');
    expect(_syncStore.convertToMp4).toBe(true);
  });

  it('does not erase unrelated stored keys', async () => {
    _syncStore = { retries: 5, autoEnqueue: true };
    await saveSettings({ concurrency: 2 });
    expect(_syncStore.retries).toBe(5);
    expect(_syncStore.autoEnqueue).toBe(true);
    expect(_syncStore.concurrency).toBe(2);
  });

  it('can persist preferredResolution', async () => {
    await saveSettings({ preferredResolution: '720p' });
    expect(_syncStore.preferredResolution).toBe('720p');
  });
});

describe('resetSettings()', () => {
  beforeEach(() => {
    _syncStore = { concurrency: 16, language: 'en', retries: 10 };
    setupChromeMock();
  });

  it('overwrites storage with defaults', async () => {
    await resetSettings();
    expect(_syncStore.concurrency).toBe(6);
    expect(_syncStore.language).toBe('zh');
    expect(_syncStore.retries).toBe(3);
    expect(_syncStore.convertToMp4).toBe(false);
    expect(_syncStore.autoEnqueue).toBe(false);
  });

  it('returns the default settings object', async () => {
    const s = await resetSettings();
    expect(s.concurrency).toBe(6);
    expect(s.language).toBe('zh');
    expect(s.retries).toBe(3);
  });

  it('returned object is independent of storage (no mutation risk)', async () => {
    const s = await resetSettings();
    (s as Record<string, unknown>).concurrency = 99;
    // reload from storage — should still be default
    const s2 = await loadSettings();
    expect(s2.concurrency).toBe(6);
  });
});
