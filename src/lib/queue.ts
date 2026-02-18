import type { QueueItem } from './types';

const KEY = 'downloadQueue';

export async function getQueue(): Promise<QueueItem[]> {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list as QueueItem[];
}

export async function enqueueItem(url: string, filename: string): Promise<QueueItem> {
  const list = await getQueue();
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
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  const list = await getQueue();
  const item = list.find(i => i.id === id);
  if (item) Object.assign(item, patch);
  await chrome.storage.local.set({ [KEY]: list });
}

export async function removeQueueItem(id: string): Promise<void> {
  const list = await getQueue();
  await chrome.storage.local.set({ [KEY]: list.filter(i => i.id !== id) });
}

export async function clearDoneItems(): Promise<void> {
  const list = await getQueue();
  await chrome.storage.local.set({ [KEY]: list.filter(i => i.status === 'pending' || i.status === 'downloading') });
}

/** Returns the next pending item (sets it to 'downloading'). */
export async function claimNextPending(): Promise<QueueItem | null> {
  const list = await getQueue();
  const item = list.find(i => i.status === 'pending');
  if (!item) return null;
  item.status = 'downloading';
  await chrome.storage.local.set({ [KEY]: list });
  return item;
}
