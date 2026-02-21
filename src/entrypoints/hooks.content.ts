/**
 * MAIN world content script — runs in the page's JS execution context.
 * Can access and patch the page's own XHR / fetch globals.
 * Cannot use chrome.* APIs; communicates via CustomEvent to the ISOLATED world script.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,

  main() {
    const EVENT = '__m3u8_detected__';

    function dispatch(raw: string) {
      const lower = raw.toLowerCase();
      if (!lower.includes('.m3u8') && !lower.includes('.mpd')) return;
      window.dispatchEvent(new CustomEvent(EVENT, { detail: raw }));
    }

    // ── Hook XHR ──────────────────────────────────────────────────
    const NativeXHR = window.XMLHttpRequest;
    // @ts-expect-error – intentionally patching native class
    class PatchedXHR extends NativeXHR {
      open(method: string, url: string, ...rest: unknown[]) {
        if (url) dispatch(String(url));
        // @ts-expect-error – variadic args on overloaded super.open
        return super.open(method, url, ...rest);
      }
    }
    window.XMLHttpRequest = PatchedXHR as typeof XMLHttpRequest;

    // ── Hook fetch ────────────────────────────────────────────────
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        dispatch(input instanceof Request ? input.url : String(input));
      } catch {}
      return nativeFetch.apply(this, arguments as never);
    };
  },
});
