import type { QueueItem } from './types';

const KEY = 'downloadQueue';

// ── Async mutex ───────────────────────────────────────────────────
// All write operations (read-modify-write) must go through this lock
// to prevent concurrent handlers from clobbering each other's writes.
let _writeLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeLock.then(fn);
  // Advance the lock regardless of success/failure so it never deadlocks
  _writeLock = next.then(
    () => {},
    () => {},
  );
  return next;
}

// Raw read — intentionally not locked (reads are idempotent)
async function readQueue(): Promise<QueueItem[]> {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list as QueueItem[];
}

export async function getQueue(): Promise<QueueItem[]> {
  return readQueue();
}

export async function enqueueItem(url: string, filename: string): Promise<QueueItem> {
  return withLock(async () => {
    const list = await readQueue();
    const item: QueueItem = {
      id: crypto.randomUUID(),
      url,
      filename,
      status: 'pending',
      progress: 0,
      addedAt: Date.now(),
    };
    list.push(item);
    await chrome.storage.local.set({ [KEY]: list });
    return item;
  });
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  return withLock(async () => {
    const list = await readQueue();
    const item = list.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
    await chrome.storage.local.set({ [KEY]: list });
  });
}

export async function removeQueueItem(id: string): Promise<void> {
  return withLock(async () => {
    const list = await readQueue();
    await chrome.storage.local.set({ [KEY]: list.filter((i) => i.id !== id) });
  });
}

export async function clearDoneItems(): Promise<void> {
  return withLock(async () => {
    const list = await readQueue();
    await chrome.storage.local.set({
      [KEY]: list.filter((i) => i.status === 'pending' || i.status === 'downloading'),
    });
  });
}

/** Returns the next pending item (sets it to 'downloading'). */
export async function claimNextPending(): Promise<QueueItem | null> {
  return withLock(async () => {
    const list = await readQueue();
    const item = list.find((i) => i.status === 'pending');
    if (!item) return null;
    item.status = 'downloading';
    await chrome.storage.local.set({ [KEY]: list });
    return item;
  });
}
