# M3U8 Stream Downloader

A browser extension that automatically detects and downloads HLS/M3U8 video streams from any webpage. Supports encrypted streams, multi-quality selection, fMP4 output, live-stream recording, batch download queue, and in-popup HLS preview.

---

## Features

### Core Download

- **Automatic detection** — intercepts XHR/Fetch calls, monitors network response headers, and scans the DOM; three parallel detection paths ensure no stream is missed.
- **Multi-quality selection** — parses HLS master playlists, sorts variants by bandwidth, and lets you pick a quality tier.
- **AES-128 decryption** — CBC mode, automatic key fetch and caching, supports both explicit IV and sequence-number-derived IV.
- **fMP4 support** — parses `#EXT-X-MAP` init segments and `#EXT-X-BYTERANGE` byte-range requests; outputs `.mp4` automatically.
- **Concurrent downloads** — configurable 1–16 threads, automatic retry with exponential backoff, immediate abort of all in-flight requests.
- **Low-memory merging** — intermediate Blob is flushed every 100 segments and ArrayBuffer references are released to prevent OOM on large files.
- **TS → MP4 conversion** — toggle to remux MPEG-TS segments into fragmented MP4 in-browser via mux.js, no FFmpeg required; falls back to `.ts` on failure.

### Enhanced Capabilities

- **Real-time speed & ETA** — 4-second rolling window for instantaneous speed, dynamic remaining-time estimate.
- **Segment range selection** — dual-slider to choose start/end segments with timestamp display and estimated clip duration.
- **Live-stream recording** — auto-detects live streams, records with one click, stops and merges into a `.ts` file.
- **Batch download queue** — add multiple streams to a queue; the background worker processes them in order automatically.
- **Download history** — stores up to 200 records (filename, size, segment count, domain); supports deletion and bulk-clear.
- **Settings sync** — concurrency and output-format preferences persisted in `chrome.storage.sync` across sessions and devices.
- **Segment status grid** — real-time dot grid showing per-segment status (grey = pending / green = ok / red = failed); auto-groups segments when count exceeds 400.
- **Partial save & retry** — on partial failure, retry only failed segments or save completed segments immediately.
- **Smart error diagnosis** — HTTP status codes categorised intelligently: 403 prompts re-login, 404 flags an expired link, 429 suggests reducing concurrency, 5xx recommends retrying later.
- **In-popup HLS preview** — click ▶ in the stream list to play the stream live inside the extension via hls.js before downloading.

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
