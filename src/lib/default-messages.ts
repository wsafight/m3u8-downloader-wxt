/**
 * Default (Chinese) fallback messages for M3U8Downloader and LiveRecorder.
 *
 * Keeping these in a dedicated module means the core business-logic files
 * (downloader.ts, live-recorder.ts) are free of embedded UI strings while
 * still providing a zero-config out-of-the-box experience.
 *
 * In production the download page always passes fully translated messages
 * via i18n.svelte.ts; these defaults are only used in tests and in the
 * rare case where a caller creates the downloader/recorder without messages.
 *
 * String values are sourced from zh-messages.ts — the single source of truth
 * for all Chinese downloader/recorder translations.
 */

import type { DownloaderMessages } from './downloader';
import type { LiveRecorderMessages } from './live-recorder';
import { ZH_DL, ZH_LR } from './zh-messages';

export const ZH_DOWNLOADER_MESSAGES: DownloaderMessages = { ...ZH_DL };

export const ZH_RECORDER_MESSAGES: LiveRecorderMessages = { ...ZH_LR };
