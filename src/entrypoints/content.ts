/**
 * ISOLATED world content script.
 * Relays M3U8 detections from the MAIN world hook (via CustomEvent) and
 * from DOM <video>/<source> elements to the background service worker.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,

  main() {
    const reported = new Set<string>();

    function report(raw: string) {
      let url: string;
      try { url = new URL(raw, location.href).href; } catch { return; }
      if (reported.has(url) || !url.toLowerCase().includes('.m3u8')) return;
      reported.add(url);
      chrome.runtime.sendMessage({ type: 'M3U8_DETECTED', url }).catch(() => {});
    }

    // ── Relay detections from MAIN world ──────────────────────────
    window.addEventListener('__m3u8_detected__', (e) => {
      report((e as CustomEvent<string>).detail);
    });

    // ── Watch <video> / <source> elements ─────────────────────────
    function checkEl(el: Element) {
      const src = el.getAttribute('src') ?? el.getAttribute('data-src');
      if (src) report(src);
    }

    const mo = new MutationObserver(muts => {
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
