import { describe, expect, test, beforeEach, mock } from 'bun:test';

// ── Mock chrome.storage.local ─────────────────────────────────────────────────
// The queue module calls chrome.storage.local.get / set synchronously in the
// module body, so we need the mock in place before importing.
const store: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: mock(async (key: string) => ({ [key]: store[key] })),
      set: mock(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj);
      }),
    },
  },
};

// @ts-expect-error – partial chrome mock for testing
globalThis.chrome = chromeMock;

// Import after mock is in place
const {
  getQueue,
  enqueueItem,
  updateQueueItem,
  removeQueueItem,
  clearDoneItems,
  claimNextPending,
} = await import('./queue');

// Reset storage between tests
beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  chromeMock.storage.local.get.mockClear();
  chromeMock.storage.local.set.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getQueue', () => {
  test('returns empty array when storage is empty', async () => {
    const q = await getQueue();
    expect(q).toEqual([]);
  });

  test('returns stored items', async () => {
    store['downloadQueue'] = [{ id: '1', status: 'pending' }];
    const q = await getQueue();
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('enqueueItem', () => {
  test('adds item with status pending and progress 0', async () => {
    const item = await enqueueItem('https://cdn.example.com/video.m3u8', 'video');
    expect(item.status).toBe('pending');
    expect(item.progress).toBe(0);
    expect(item.url).toBe('https://cdn.example.com/video.m3u8');
    expect(item.filename).toBe('video');
    expect(typeof item.id).toBe('string');
  });

  test('assigns unique ids', async () => {
    const a = await enqueueItem('https://a.example.com/a.m3u8', 'a');
    const b = await enqueueItem('https://b.example.com/b.m3u8', 'b');
    expect(a.id).not.toBe(b.id);
  });

  test('persists multiple items in order', async () => {
    await enqueueItem('https://cdn.example.com/1.m3u8', 'first');
    await enqueueItem('https://cdn.example.com/2.m3u8', 'second');
    const q = await getQueue();
    expect(q).toHaveLength(2);
    expect(q[0].filename).toBe('first');
    expect(q[1].filename).toBe('second');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateQueueItem', () => {
  test('patches existing item fields', async () => {
    const item = await enqueueItem('https://cdn.example.com/v.m3u8', 'v');
    await updateQueueItem(item.id, { progress: 0.5, status: 'downloading' });
    const q = await getQueue();
    const updated = q.find((i) => i.id === item.id)!;
    expect(updated.progress).toBe(0.5);
    expect(updated.status).toBe('downloading');
  });

  test('does nothing when id is not found', async () => {
    await enqueueItem('https://cdn.example.com/v.m3u8', 'v');
    // Should not throw
    await expect(updateQueueItem('nonexistent-id', { progress: 1 })).resolves.toBeUndefined();
    const q = await getQueue();
    expect(q[0].progress).toBe(0); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('removeQueueItem', () => {
  test('removes item by id', async () => {
    const a = await enqueueItem('https://cdn.example.com/a.m3u8', 'a');
    const b = await enqueueItem('https://cdn.example.com/b.m3u8', 'b');
    await removeQueueItem(a.id);
    const q = await getQueue();
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe(b.id);
  });

  test('no-op when id does not exist', async () => {
    await enqueueItem('https://cdn.example.com/a.m3u8', 'a');
    await removeQueueItem('no-such-id');
    expect(await getQueue()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('clearDoneItems', () => {
  test('removes done and error items but keeps pending/downloading', async () => {
    const a = await enqueueItem('https://cdn.example.com/a.m3u8', 'a');
    const b = await enqueueItem('https://cdn.example.com/b.m3u8', 'b');
    const c = await enqueueItem('https://cdn.example.com/c.m3u8', 'c');
    await updateQueueItem(a.id, { status: 'done' });
    await updateQueueItem(b.id, { status: 'downloading' });
    await updateQueueItem(c.id, { status: 'error' });
    await clearDoneItems();
    const q = await getQueue();
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe(b.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('claimNextPending', () => {
  test('returns null when queue is empty', async () => {
    expect(await claimNextPending()).toBeNull();
  });

  test('claims first pending item and marks it downloading', async () => {
    const item = await enqueueItem('https://cdn.example.com/v.m3u8', 'v');
    const claimed = await claimNextPending();
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(item.id);
    // Status in storage should be updated
    const q = await getQueue();
    expect(q[0].status).toBe('downloading');
  });

  test('skips non-pending items', async () => {
    const a = await enqueueItem('https://cdn.example.com/a.m3u8', 'a');
    const b = await enqueueItem('https://cdn.example.com/b.m3u8', 'b');
    await updateQueueItem(a.id, { status: 'done' });
    const claimed = await claimNextPending();
    expect(claimed!.id).toBe(b.id);
  });

  test('returns null when all items are non-pending', async () => {
    const a = await enqueueItem('https://cdn.example.com/a.m3u8', 'a');
    await updateQueueItem(a.id, { status: 'done' });
    expect(await claimNextPending()).toBeNull();
  });
});
