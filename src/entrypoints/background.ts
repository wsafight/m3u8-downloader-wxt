import type { AppMessage, StreamInfo } from '../lib/types';
import { claimNextPending, updateQueueItem } from '../lib/queue';
import { MSG } from '../lib/messages';

// tabId -> Map<url, StreamInfo>
const store = new Map<number, Map<string, StreamInfo>>();

/** Maximum number of stream URLs tracked per tab. Oldest entries are evicted first. */
const MAX_STREAMS_PER_TAB = 50;

// Check pathname AND query string so URLs like ?file=video.m3u8 are not missed
function isStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const combined = (u.pathname + u.search).toLowerCase();
    return combined.includes('.m3u8') || combined.includes('.mpd');
  } catch {
    return false;
  }
}

function isStreamContentType(headers?: chrome.webRequest.HttpHeader[]): boolean {
  const ct =
    headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value?.toLowerCase() ?? '';
  return ct.includes('mpegurl') || ct.includes('m3u8') || ct.includes('dash+xml');
}

function addStream(tabId: number, url: string) {
  if (!store.has(tabId)) store.set(tabId, new Map());
  const tab = store.get(tabId)!;
  if (tab.has(url)) return;

  // Enforce per-tab cap: evict the oldest entry when the limit is reached.
  if (tab.size >= MAX_STREAMS_PER_TAB) {
    const oldest = [...tab.values()].reduce((a, b) => (a.detectedAt < b.detectedAt ? a : b));
    tab.delete(oldest.url);
  }

  // Insert with empty title first so the badge updates immediately,
  // then backfill the page title asynchronously.
  tab.set(url, { url, title: '', detectedAt: Date.now() });
  updateBadge(tabId);
  chrome.tabs.get(tabId, (t) => {
    if (chrome.runtime.lastError) return; // tab may have closed
    const entry = store.get(tabId)?.get(url);
    if (entry) entry.title = t.title ?? '';
  });
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
      if (isStreamUrl(url) || isStreamContentType(responseHeaders)) addStream(tabId, url);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders'],
  );

  // ── Message handling ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((rawMsg, sender, respond) => {
    const msg = rawMsg as AppMessage;

    switch (msg.type) {
      case MSG.M3U8_DETECTED: {
        const tabId = sender.tab?.id ?? msg.tabId ?? -1;
        if (tabId >= 0) addStream(tabId, msg.url);
        respond({ ok: true });
        break;
      }

      case MSG.GET_STREAMS:
        respond({ streams: Array.from(store.get(msg.tabId)?.values() ?? []) });
        break;

      case MSG.REMOVE_STREAM:
        store.get(msg.tabId)?.delete(msg.url);
        updateBadge(msg.tabId);
        respond({ ok: true });
        break;

      case MSG.CLEAR_STREAMS:
        store.delete(msg.tabId);
        updateBadge(msg.tabId);
        respond({ ok: true });
        break;

      // ── Queue messages ────────────────────────────────────────
      case MSG.ENQUEUE:
        processNextQueueItem().catch((e) =>
          console.error('[Queue] processNextQueueItem failed:', e),
        );
        respond({ ok: true });
        break;

      case MSG.QUEUE_ITEM_DONE:
        updateQueueItem(msg.queueId, { status: msg.status, errorMsg: msg.errorMsg })
          .then(() => processNextQueueItem())
          .catch((e) => console.error('[Queue] QUEUE_ITEM_DONE handling failed:', e));
        respond({ ok: true });
        break;

      case MSG.QUEUE_PROGRESS:
        updateQueueItem(msg.queueId, { progress: msg.progress }).catch((e) =>
          console.error('[Queue] progress update failed:', e),
        );
        respond({ ok: true });
        break;
    }
    return true;
  });

  // ── Cleanup ──────────────────────────────────────────────────
  chrome.tabs.onRemoved.addListener((tabId) => store.delete(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) {
      store.delete(tabId);
      updateBadge(tabId);
    }
  });
});
