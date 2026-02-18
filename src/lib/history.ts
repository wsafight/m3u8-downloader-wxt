import type { HistoryEntry } from './types';

const KEY = 'downloadHistory';
const MAX = 200;

export async function addHistoryEntry(entry: Omit<HistoryEntry, 'id'>): Promise<void> {
  const list = await getHistory();
  list.unshift({ ...entry, id: crypto.randomUUID() });
  await chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list as HistoryEntry[];
}

export async function removeHistoryEntry(id: string): Promise<void> {
  const list = await getHistory();
  await chrome.storage.local.set({ [KEY]: list.filter((e) => e.id !== id) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] });
}
