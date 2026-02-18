# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.0] - 2026-02-19

### Feature

- **DASH / MPD support** (`src/lib/mpd-parser.ts` — new, 328 lines):
  - Minimal MPEG-DASH parser covering `SegmentTemplate` (`$Number$` / `$Time$` / `$Bandwidth$` tokens) and `SegmentList` formats.
  - Output is fully compatible with the existing `MasterPlaylist` / `MediaPlaylist` types, so the downloader transparently handles both HLS and DASH streams.
  - `M3U8Downloader.download()` auto-detects MPD vs M3U8 by inspecting the URL and content; no caller changes required.

- **Internationalisation** (`src/lib/i18n.svelte.ts` — new, 270 lines):
  - Reactive Svelte 5 i18n store with full `zh` and `en` translations covering all UI strings across popup, download page, and settings.
  - `i18n.t(key, ...args)` template helper; language stored in `UserSettings.language` and persisted to `chrome.storage.sync`.
  - Language toggle (ZH / EN) available in both the download page header and the new Settings tab.

- **Settings tab** (`src/entrypoints/popup/SettingsTab.svelte` — new, 393 lines):
  - Dedicated settings panel in the popup with sections for Language, Download, Behaviour, and About.
  - Controls: language toggle, concurrency slider (1–16), retries slider (1–10), "Convert to MP4" checkbox, "Auto-enqueue" checkbox.
  - **Reset to defaults** button restores all settings via the new `resetSettings()` helper.

- **Download resume / checkpoint** (`src/entrypoints/download/App.svelte`):
  - Progress is checkpointed to `chrome.storage.local` every 10 completed segments.
  - On next open the page detects an existing checkpoint and offers to resume, skipping already-downloaded segments.
  - Checkpoint is cleared on successful completion or manual dismissal.

- **Batch stream selection** (`src/entrypoints/popup/App.svelte`):
  - Select-all / deselect-all toggle in the stream list header.
  - "Batch enqueue" button adds all selected streams to the queue at once.

- **Audio track muxing** (`src/lib/downloader.ts`):
  - `M3U8Downloader` accepts an optional `audioTrackUrl` to download a separate audio rendition and mux it alongside the video segments.

### Fixed / Improved

- **HTTP error classification** (`src/lib/downloader.ts`):
  - Introduced `HttpError` with an optional `retryAfterMs` field.
  - `classifyHttpError()` emits actionable messages for 403 (access denied / login required), 404 (segment expired), 429 (rate limited), and 5xx (server error).
  - 429 responses honour the `Retry-After` header (capped at 60 s) instead of the fixed back-off, stored in `HttpError.retryAfterMs`.

### Types

- **`DownloadCheckpoint`** — new interface (`url`, `filename`, `segmentUrls`, `doneIndices`, `savedAt`).
- **`MediaTrack`** — new interface (`type: 'SUBTITLES' | 'AUDIO'`, `name`, `language`, `uri`).
- **`AppMessage`** union type moved to `src/lib/types.ts` (was inline strings).
- `MasterPlaylist` gains `mediaTracks: MediaTrack[]`; `MediaPlaylist` gains optional `subtitleTracks?: MediaTrack[]`.

### Settings

- `UserSettings` gains three new fields: `language: Lang` (default `'zh'`), `retries: number` (default `3`), `autoEnqueue: boolean` (default `false`).
- New `resetSettings()` export in `src/lib/settings.ts`.

### Tests

- **`src/lib/downloader.test.ts`** (329 lines) — new test suite covering:
  - HTTP error classification (403, 404, 500, 206 partial-content)
  - 429 `Retry-After` wait and 60 s cap
  - `_calcSpeed()` edge cases
  - `pool()` concurrency and early-abort behaviour
  - `PartialDownloadError` shape
  - `downloadSegments()` partial-failure path
  - `savePartial()` empty-segment guard
  - `abort()` state and rejection
  - `decryptAES128()` correctness
  - fMP4 init-segment cache (fetched only once for duplicate URLs)

---

## [0.2.0] - 2026-02-18

### Refactor

- **Split `download/App.svelte`** (1557 → 918 lines) by extracting five focused sub-components:
  - `LogTerminal.svelte` — scrollable log output, auto-scrolls via `$effect`
  - `SegmentGrid.svelte` — dot-grid visualisation of per-segment download status
  - `ProgressDisplay.svelte` — progress bar, ETA, speed, and phase label
  - `RecordingStatus.svelte` — live recording stats (segment count, duration, bytes)
  - `ActionButtons.svelte` — all action buttons with their complete style definitions

- **Typed message constants** — created `src/lib/messages.ts` exporting a `MSG` `as const` object and a `MessageType` union type. All string-literal message types in `background.ts`, `content.ts`, `popup/App.svelte`, and `download/App.svelte` are replaced with `MSG.*` references, eliminating stringly-typed inter-component communication.

### Fixed

- **`LiveRecorder` error surfacing** (`src/lib/live-recorder.ts`):
  - Empty `catch {}` blocks no longer silently swallow errors.
  - Playlist fetch failures now call `onStatus(...)` with the actual error message, distinguishing `AbortError` (expected on stop) from real network failures.
  - `_downloadSegment` captures `lastError` and includes it in the skip-segment status message.

- **`savedExt` reactivity** (`src/entrypoints/download/App.svelte`):
  `let savedExt = 'ts'` changed to `let savedExt = $state('ts')` to satisfy Svelte 5.51.3's stricter reactive-variable checks.

### Accessibility

- Replaced cosmetic `<label>` elements (not associated with any form control) in `download/App.svelte` with `<span>` elements, adding `role="group"` and `aria-labelledby` to the corresponding control groups:
  - Output format toggle group
  - Quality selection list
- Added `aria-label="开始下载"` to the icon-only go button in `popup/App.svelte`.

### Types

- **Eliminated `(mux as any)`** in `src/lib/remux.ts` by introducing a typed `MuxModule` interface and casting via `as unknown as MuxModule`, making the mux.js interop fully type-safe.

### Feature

- **Persist `convertToMp4` preference** — `src/lib/settings.ts` adds `convertToMp4: boolean` to `UserSettings` (default `false`). The download page saves and restores this setting via `chrome.storage.sync`, so the chosen output format survives page reloads and device changes.

### Tests

- **`src/lib/queue.test.ts`** (164 lines) — covers `getQueue`, `enqueueItem`, `updateQueueItem`, `removeQueueItem`, `clearDoneItems`, and `claimNextPending` with mocked `chrome.storage.local`.
- **`src/lib/live-recorder.test.ts`** (213 lines) — covers construction, VOD recording (segment count, ok status), HTTP error handling, segment-download failures, deduplication across polls, `stop()` abort behaviour, and `saveAs()` return value, using a configurable `fetch` mock.

### Style

- Added CSS custom-property fallback values (e.g. `var(--error, #f87171)`, `var(--accent-grad, linear-gradient(…))`) to all five new sub-components so they render correctly even outside the main theme context.

### Dependencies

| Package                        | Before  | After    |
| ------------------------------ | ------- | -------- |
| `svelte`                       | ^5.0.0  | ^5.51.3  |
| `@sveltejs/vite-plugin-svelte` | ^4.0.0  | ^6.2.4   |
| `typescript`                   | ^5.5.0  | ^5.9.3   |
| `wxt`                          | ^0.20.0 | ^0.20.17 |

---

## [0.1.0] - initial release

- HLS / M3U8 stream detection via content script and `webRequest` listener.
- Popup listing detected streams with quality selection and one-click enqueue.
- Download page with concurrent segment fetching, AES-128 decryption, fMP4 remuxing via mux.js, and `.ts` / `.mp4` output.
- Live-stream recording mode with playlist polling and local concatenation.
- Configurable concurrency stored in `chrome.storage.sync`.
