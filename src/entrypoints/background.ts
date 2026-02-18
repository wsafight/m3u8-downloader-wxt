import type { StreamInfo } from '../lib/types';
import { claimNextPending, updateQueueItem } from '../lib/queue';

// tabId -> Map<url, StreamInfo>
const store = new Map<number, Map<string, StreamInfo>>();

// Check pathname AND query string so URLs like ?file=video.m3u8 are not missed
function isM3U8Url(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).toLowerCase().includes('.m3u8');
  } catch { return false; }
}

function isM3U8ContentType(headers?: chrome.webRequest.HttpHeader[]): boolean {
  const ct = headers?.find(h => h.name.toLowerCase() === 'content-type')?.value?.toLowerCase() ?? '';
  return ct.includes('mpegurl') || ct.includes('m3u8');
}

function addStream(tabId: number, url: string) {
  if (!store.has(tabId)) store.set(tabId, new Map());
  const tab = store.get(tabId)!;
  if (tab.has(url)) return;
  tab.set(url, { url, title: '', detectedAt: Date.now() });
  updateBadge(tabId);
}

function updateBadge(tabId: number) {
  const n = store.get(tabId)?.size ?? 0;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#5b9df6', tabId });
}

// ── Queue processing ──────────────────────────────────────────────

async function processNextQueueItem() {
  const item = await claimNextPending();
  if (!item) return;
  const q = new URLSearchParams({ url: item.url, filename: item.filename, queueId: item.id });
  chrome.tabs.create({ url: chrome.runtime.getURL('download.html') + '?' + q });
}

// ── Background entry ──────────────────────────────────────────────

export default defineBackground(() => {
  // ── Network interception ─────────────────────────────────────
  chrome.webRequest.onResponseStarted.addListener(
    ({ tabId, url, responseHeaders }) => {
      if (tabId < 0) return;
      if (isM3U8Url(url) || isM3U8ContentType(responseHeaders)) addStream(tabId, url);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders'],
  );

  // ── Message handling ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    const tabId: number = sender.tab?.id ?? msg.tabId ?? -1;

    switch (msg.type as string) {
      case 'M3U8_DETECTED':
        if (tabId >= 0) addStream(tabId, msg.url as string);
        respond({ ok: true });
        break;

      case 'GET_STREAMS':
        respond({ streams: Array.from(store.get(msg.tabId as number)?.values() ?? []) });
        break;

      case 'REMOVE_STREAM':
        store.get(msg.tabId as number)?.delete(msg.url as string);
        updateBadge(msg.tabId as number);
        respond({ ok: true });
        break;

      case 'CLEAR_STREAMS':
        store.delete(msg.tabId as number);
        updateBadge(msg.tabId as number);
        respond({ ok: true });
        break;

      // ── Queue messages ────────────────────────────────────────
      case 'ENQUEUE': {
        // Queue is persisted via queue.ts; background just triggers processing
        processNextQueueItem().catch(() => {});
        respond({ ok: true });
        break;
      }

      case 'QUEUE_ITEM_DONE': {
        // Download page notifies completion; update item and move to next
        const { queueId, status, errorMsg } = msg as { queueId: string; status: string; errorMsg?: string };
        updateQueueItem(queueId, { status: status as 'done' | 'error', errorMsg }).then(() => {
          processNextQueueItem().catch(() => {});
        }).catch(() => {});
        respond({ ok: true });
        break;
      }

      case 'QUEUE_PROGRESS': {
        // Download page reports progress; persist it
        const { queueId, progress } = msg as { queueId: string; progress: number };
        updateQueueItem(queueId, { progress }).catch(() => {});
        respond({ ok: true });
        break;
      }
    }
    return true;
  });

  // ── Cleanup ──────────────────────────────────────────────────
  chrome.tabs.onRemoved.addListener(tabId => store.delete(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) { store.delete(tabId); updateBadge(tabId); }
  });
});
