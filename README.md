# M3U8 Stream Downloader

English | [简体中文](./README_CN.md)

A browser extension that automatically detects and downloads HLS/M3U8 video streams from any webpage. Supports encrypted streams, multi-quality selection, fMP4 output, live-stream recording, batch download queue, and in-popup HLS preview.

---

## Features

### Core

- **Triple auto-detection** — intercepts XHR/Fetch calls, monitors network response headers, and scans the DOM; three parallel paths ensure no stream is missed.
- **Preview before download** — click ▶ in the stream list to play the stream inside the extension via hls.js; verify content before committing to a download.
- **AES-128 encrypted streams** — CBC mode, automatic key fetch and caching, supports both explicit IV and sequence-number-derived IV; decryption runs fully in-browser via Web Crypto API.
- **Multi-quality selection** — parses HLS master playlists, sorts variants by bandwidth, lets you pick 1080p / 720p / 480p or any available tier.
- **Cookie auto pass-through** — downloads carry the current page's Cookie and Referer automatically, bypassing auth walls on login-required streaming sites with zero config.
- **Live-stream recording** — auto-detects live streams (no `#EXT-X-ENDLIST`), records with one click, stops and merges into a `.ts` file.
- **TS → MP4 remux** — toggle to remux MPEG-TS into fragmented MP4 in-browser via mux.js, no FFmpeg required; falls back to `.ts` on failure.
- **Batch download queue** — add multiple streams from the popup; the background Service Worker processes them in order automatically.
- **Segment grid & partial retry** — real-time dot grid (grey/green/red) per segment; on partial failure, retry only failed segments or save completed ones immediately.

### Under the Hood

- **Real-time speed & ETA** — 4-second rolling window for instantaneous speed and dynamic remaining-time estimate.
- **Segment range clipping** — dual-slider to choose start/end segments with live timestamp and clip-duration display.
- **fMP4 & BYTERANGE support** — parses `#EXT-X-MAP` init segments and `#EXT-X-BYTERANGE` requests; full modern HLS compatibility.
- **Download history** — stores up to 200 records (filename, size, segment count, domain); supports deletion and bulk-clear.
- **Smart error diagnosis** — 403 prompts re-login, 404 flags expired links, 429 suggests lower concurrency, 5xx recommends retrying later.
- **Low-memory merge & sync settings** — Blobs flushed every 100 segments to prevent OOM; concurrency and format preferences persisted via `chrome.storage.sync`.

---

## Tech Stack

| Layer                         | Technology                                                         |
| ----------------------------- | ------------------------------------------------------------------ |
| Extension framework           | [WXT](https://wxt.dev) v0.20 — Manifest V3, Chrome + Firefox       |
| UI framework                  | [Svelte 5](https://svelte.dev) (`$state` / `$derived` / `$effect`) |
| Language                      | TypeScript 5.9 (strict mode)                                       |
| Bundler                       | Vite 7 (via WXT)                                                   |
| Package manager & test runner | [Bun](https://bun.sh)                                              |
| TS → MP4 remuxing             | [mux.js](https://github.com/videojs/mux.js) 6.3                    |
| HLS preview                   | [hls.js](https://github.com/video-dev/hls.js) 1.6                  |

---

## Development

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- Chrome 109+ or Firefox 109+

### Install dependencies

```bash
bun install
```

### Dev mode

```bash
# Chrome (default)
bun run dev

# Firefox
bun run dev:firefox
```

WXT launches a browser with the extension hot-loaded.

### Build

```bash
bun run build          # Chrome
bun run build:firefox  # Firefox
```

Output goes to `.output/chrome-mv3/` (or `firefox-mv2/`).

### Package for distribution

```bash
bun run zip          # Chrome zip
bun run zip:firefox  # Firefox zip
```

### Run tests

```bash
bun test
```

---

## Load the Extension

1. Open `chrome://extensions` in your browser.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3/`.

---

## Project Structure

```
src/
├── entrypoints/
│   ├── hooks.content.ts           # MAIN world — intercepts page XHR / fetch
│   ├── content.ts                 # ISOLATED world — DOM scan + message relay
│   ├── background.ts              # Service Worker — network intercept, stream store, queue
│   ├── popup/
│   │   ├── App.svelte             # Popup root (stream list / queue / history tabs)
│   │   ├── QueueTab.svelte        # Queue tab
│   │   └── HistoryTab.svelte      # History tab
│   └── download/
│       ├── App.svelte             # Download page root
│       ├── ActionButtons.svelte   # Start / abort / retry buttons
│       ├── LogTerminal.svelte     # Scrollable activity log
│       ├── ProgressDisplay.svelte # Progress bar + ETA
│       ├── RecordingStatus.svelte # Live recording stats
│       ├── SegmentGrid.svelte     # Per-segment status dots
│       └── SegmentRangeSlider.svelte # Dual-slider range selector
└── lib/
    ├── types.ts          # Shared type definitions
    ├── messages.ts       # Inter-component message constants
    ├── settings.ts       # User settings (chrome.storage.sync)
    ├── m3u8-parser.ts    # HLS playlist parser
    ├── downloader.ts     # Download engine (concurrency, decrypt, merge, speed)
    ├── live-recorder.ts  # Live recorder (poll, dedup, chunked Blob)
    ├── remux.ts          # MPEG-TS → fMP4 via mux.js
    ├── queue.ts          # Download queue CRUD (chrome.storage.local)
    └── history.ts        # Download history CRUD (chrome.storage.local)
```

---

## Architecture

### Detection Pipeline

```
Page XHR / fetch ──► hooks.content.ts  (MAIN world)
                              │  CustomEvent "__m3u8_detected__"
                              ▼
                         content.ts  (ISOLATED world) ──► background.ts
                              │                                  │
                   DOM <video> / <source>             webRequest response headers
                                                               │
                                                        update badge count
```

The MAIN-world hook can access the page's real `window.fetch` and `window.XMLHttpRequest` (the isolated world cannot). The two content scripts communicate via `CustomEvent`, while the background service worker provides a safety net via the `webRequest` API.

### VOD Download Pipeline

```
M3U8 URL
   │
   ├─► Parse master playlist → select quality variant
   │
   ├─► Parse media playlist → extract segments + encryption info + init segment
   │
   ├─► [Optional] dual-slider: pick startIndex ~ endIndex
   │
   ├─► Concurrent segment fetch (worker pool, AbortController for instant cancel)
   │       ├─► AES-128 decrypt (key cache reuse)
   │       └─► Speed sampling (4-second rolling window) → ETA
   │
   ├─► Batch-merge Blob every 100 segments, release ArrayBuffer
   │
   ├─► [Optional] TS → fMP4 remux via mux.js
   │
   ├─► chrome.downloads.download() → save to disk
   │
   └─► Write download history (chrome.storage.local)
```

### Live Recording Pipeline

```
Live M3U8 URL (isEndList=false)
   │
   ├─► Enter recording mode
   │
   ├─► Poll playlist every targetDuration / 2 seconds
   │       └─► Filter already-seen URLs (Set<string> dedup)
   │               └─► Download new segments → append to pending[]
   │                       └─► every 100 segments → flush to Blob (free memory)
   │
   ├─► User clicks Stop → _stopping = true, AbortController.abort()
   │
   └─► saveAs() → merge all Blobs → chrome.downloads saves .ts
```

### Queue Scheduling

```
popup → enqueueItem() → chrome.storage.local
      → sendMessage(ENQUEUE) → background.ts
                                     │
                           processNextQueueItem()
                                     │
                           chrome.tabs.create(download.html?queueId=…)
                                     │
                           download/App.svelte completes
                           sendMessage(QUEUE_ITEM_DONE)
                                     │
                           background processes next item
```

---

## Permissions

| Permission                     | Reason                                            |
| ------------------------------ | ------------------------------------------------- |
| `webRequest`                   | Detect M3U8 via response Content-Type header      |
| `downloads`                    | Save merged video files to disk                   |
| `storage`                      | Persist settings, history, and queue              |
| `tabs`                         | Get tab ID and open download page for queue items |
| `scripting` / `activeTab`      | Inject content scripts                            |
| `host_permissions: <all_urls>` | Monitor requests on any website                   |

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT
