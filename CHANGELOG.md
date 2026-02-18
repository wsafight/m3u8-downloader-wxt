# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
