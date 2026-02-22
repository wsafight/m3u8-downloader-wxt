/**
 * ISOLATED world content script.
 * Relays M3U8 detections from the MAIN world hook (via CustomEvent) and
 * from DOM <video>/<source> elements to the background service worker.
 */
import { MSG } from '../lib/messages';
import { isStreamUrl } from '../lib/utils';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    /** Cap to prevent unbounded growth in long-lived SPA sessions. */
    const MAX_REPORTED = 500;
    const reported = new Set<string>();

    function report(raw: string) {
      let url: string;
      try {
        url = new URL(raw, location.href).href;
      } catch {
        return;
      }
      if (reported.has(url) || !isStreamUrl(url)) return;
      // Evict the oldest entry when the cap is reached (Set preserves insertion order).
      if (reported.size >= MAX_REPORTED) {
        reported.delete(reported.values().next().value!);
      }
      reported.add(url);
      chrome.runtime.sendMessage({ type: MSG.M3U8_DETECTED, url }).catch(() => {});
    }

    // ── Relay detections from MAIN world ──────────────────────────
    window.addEventListener('__m3u8_detected__', (e) => {
      report((e as CustomEvent<string>).detail);
    });

    // ── Watch <video> / <source> elements ─────────────────────────
    function checkEl(el: Element) {
      const src = el.getAttribute('src') ?? el.getAttribute('data-src');
      if (src) report(src);
      // Also detect DASH sources via type attribute
      const type = el.getAttribute('type') ?? '';
      if (type.includes('dash+xml') || type.includes('mpd')) {
        const dashSrc = el.getAttribute('src');
        if (dashSrc) report(dashSrc);
      }
    }

    const mo = new MutationObserver((muts) => {
      for (const m of muts)
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('video,source')) checkEl(node);
          node.querySelectorAll('video,source').forEach(checkEl);
        }
    });

    const scan = () => document.querySelectorAll('video,source').forEach(checkEl);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        scan();
        mo.observe(document.documentElement, { childList: true, subtree: true });
      });
    } else {
      scan();
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  },
});
