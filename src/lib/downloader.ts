import { M3U8Parser } from './m3u8-parser';
import { MpdParser } from './mpd-parser';
import { remuxTsToMp4 } from './remux';
import {
  cacheSegment,
  cacheTotalCount,
  clearCachedSegments,
  loadCachedSegments,
} from './segment-cache';
import { aesDecrypt, importAesKey, seqToIV } from './crypto-utils';
import { ZH_DOWNLOADER_MESSAGES } from './default-messages';
import type { ByteRange, DownloadCheckpoint, DownloadPhase, InitSegment, Segment, SegmentStatus, StreamDef } from './types';

/** Internal sentinel used to signal a user-initiated abort across async boundaries. */
export const ABORT_MSG = '__M3U8DL_ABORTED__';

/** All user-visible status messages emitted by the downloader.
 *  Pass a translated object via `DownloaderOptions.messages` to support i18n. */
export interface DownloaderMessages {
  fetchingPlaylist: string;
  noStreamsInMaster: string;
  fetchingStream: (label: string) => string;
  noSegmentsInMedia: string;
  fetchingInitSegment: string;
  segmentInfo: (total: number, fmt: string, dur: string) => string;
  restoredFromCache: (count: number) => string;
  segmentFailed: (index: number) => string;
  someSegmentsFailed: (count: number) => string;
  noFailedSegments: string;
  retryingFailed: (count: number) => string;
  segmentRetryFailed: (index: number) => string;
  stillFailed: (count: number) => string;
  retryComplete: string;
  merging: string;
  noOkSegments: string;
  savingPartial: (count: number) => string;
  savedPartial: (count: number, mb: string) => string;
  convertingMp4: string;
  mp4ConvertDone: string;
  mp4ConvertFailed: (msg: string) => string;
  prepareSave: string;
  downloadComplete: (segs: number, mb: string) => string;
  networkError: (url: string) => string;
  http403: (url: string) => string;
  http404: (url: string) => string;
  http429: (url: string) => string;
  httpServer: (status: number, url: string) => string;
  httpGeneric: (status: number, url: string) => string;
  aes128MissingKey: string;
  circuitOpen: (n: number) => string;
}


export interface DownloaderOptions {
  concurrency?: number;
  retries?: number;
  startIndex?: number; // inclusive, for range downloads
  endIndex?: number; // inclusive, for range downloads
  convertToMp4?: boolean; // remux TS → fMP4 after download
  audioTrackUrl?: string; // optional separate audio track URL to mux in
  /** Translated status messages. Defaults to Chinese if not provided. */
  messages?: DownloaderMessages;
  onProgress?: (
    ratio: number,
    done: number,
    total: number,
    speedBps: number,
    downloadedBytes: number,
  ) => void;
  onStatus?: (msg: string, type?: 'info' | 'ok' | 'warn' | 'error') => void;
  onPhaseChange?: (phase: DownloadPhase) => void;
  onQualityChoice?: (streams: StreamDef[]) => Promise<StreamDef>;
  /**
   * Custom save handler. When provided, the downloader calls this instead of
   * the built-in `chrome.downloads.download` / `<a>` fallback. Useful for
   * testing or non-extension environments.
   */
  onSaveBlob?: (blob: Blob, filename: string) => Promise<void>;
  /** Called once when the total segment count is known, before downloading starts.
   *  Use this to initialise the segment status grid. */
  onSegmentCount?: (total: number) => void;
  /** Called for each individual segment status change (incremental update). */
  onSegmentStatus?: (index: number, status: SegmentStatus) => void;
  /** When set, completed segment buffers are persisted to IndexedDB so the
   *  download can be resumed after an interruption. */
  cacheKey?: string;
  /** Abort if this many consecutive segment failures occur (default: 10).
   *  Set to 0 to disable. */
  circuitBreakerThreshold?: number;
  /** Per-request fetch timeout in milliseconds (default: 30 000).
   *  Applies to every segment, key, and playlist fetch. */
  fetchTimeout?: number;
}

export interface DownloadResult {
  bytes: number;
  segments: number;
  ext: string; // 'ts' or 'mp4'
}

export class PartialDownloadError extends Error {
  constructor(public readonly failedCount: number) {
    super(`partial download: ${failedCount} segment(s) failed`);
    this.name = 'PartialDownloadError';
  }
}

class HttpError extends Error {
  retryAfterMs?: number;
  /** True for errors where retrying is pointless (403, 404). */
  permanent: boolean;
  constructor(message: string, opts?: { retryAfterMs?: number; permanent?: boolean }) {
    super(message);
    this.name = 'HttpError';
    this.retryAfterMs = opts?.retryAfterMs;
    this.permanent = opts?.permanent ?? false;
  }
}

const MERGE_BATCH = 100;

export class M3U8Downloader {
  private concurrency: number;
  private retries: number;
  private startIndex: number | undefined;
  private endIndex: number | undefined;
  private convertToMp4: boolean;
  private audioTrackUrl: string | undefined;
  private msgs: DownloaderMessages;
  private onProgress: NonNullable<DownloaderOptions['onProgress']>;
  private onStatus: NonNullable<DownloaderOptions['onStatus']>;
  private onPhaseChange: DownloaderOptions['onPhaseChange'];
  private onQualityChoice: DownloaderOptions['onQualityChoice'];
  private onSegmentCount: DownloaderOptions['onSegmentCount'];
  private onSegmentStatus: DownloaderOptions['onSegmentStatus'];
  private onSaveBlob: DownloaderOptions['onSaveBlob'];
  private cacheKey: string | undefined;
  private circuitBreakerThreshold: number;
  private fetchTimeout: number;
  private _consecutiveFailures = 0;
  private _aborted = false;
  private _paused = false;
  private _pauseQueue: Array<() => void> = [];
  private _abortController: AbortController | null = null;
  private _keyCache = new Map<string, CryptoKey>();
  private _initCache = new Map<string, ArrayBuffer>();
  // Speed tracking — fixed-size ring buffer avoids unbounded array growth.
  // 60 slots is enough for 4-second windows at up to 16 concurrent workers.
  private static readonly SPEED_BUF_SIZE = 60;
  private _downloadedBytes = 0;
  private _speedBuf = new Float64Array(M3U8Downloader.SPEED_BUF_SIZE * 2); // [t0,b0, t1,b1, …]
  private _speedWrite = 0; // next write position (mod SPEED_BUF_SIZE)
  private _speedCount = 0; // how many valid entries are in the buffer

  // Per-download state (preserved after completion for retry/savePartial)
  private _segStatuses: SegmentStatus[] = [];
  private _buffers: Array<ArrayBuffer | null> = [];
  private _pendingSegments: Segment[] = [];
  private _pendingInitBuffer: ArrayBuffer | null = null;
  private _pendingIsFmp4 = false;
  private _pendingFilename = '';

  constructor(opts: DownloaderOptions = {}) {
    this.concurrency = opts.concurrency ?? 6;
    this.retries = opts.retries ?? 3;
    this.startIndex = opts.startIndex;
    this.endIndex = opts.endIndex;
    this.convertToMp4 = opts.convertToMp4 ?? false;
    this.audioTrackUrl = opts.audioTrackUrl;
    this.msgs = opts.messages ?? ZH_DOWNLOADER_MESSAGES;
    this.onProgress = opts.onProgress ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
    this.onPhaseChange = opts.onPhaseChange;
    this.onQualityChoice = opts.onQualityChoice;
    this.onSegmentCount = opts.onSegmentCount;
    this.onSegmentStatus = opts.onSegmentStatus;
    this.cacheKey = opts.cacheKey;
    this.circuitBreakerThreshold = opts.circuitBreakerThreshold ?? 10;
    this.fetchTimeout = opts.fetchTimeout ?? 30_000;
    this.onSaveBlob = opts.onSaveBlob;
  }

  abort() {
    this._aborted = true;
    // Unblock all paused workers so they can observe _aborted and exit.
    for (const resolve of this._pauseQueue.splice(0)) resolve();
    this._abortController?.abort();
    // Release downloaded segment buffers immediately so the GC can reclaim
    // memory without waiting for the next download page close.
    this._buffers = [];
  }

  /** Suspend new segment fetches (in-flight requests finish naturally). */
  pause() {
    if (this._aborted || this._paused) return;
    this._paused = true;
    this.onPhaseChange?.('paused');
  }

  /** Resume a paused download. */
  resume() {
    if (!this._paused) return;
    this._paused = false;
    for (const resolve of this._pauseQueue.splice(0)) resolve();
    this.onPhaseChange?.('downloading');
  }

  /** Current per-segment statuses (snapshot copy). */
  get segmentStatuses(): readonly SegmentStatus[] {
    return this._segStatuses;
  }

  /** Indices of segments that failed in the last download. */
  get failedIndices(): number[] {
    return this._segStatuses
      .map((s, i) => (s === 'failed' ? i : -1))
      .filter((i): i is number => i !== -1);
  }

  async download(m3u8Url: string, filename = 'video'): Promise<DownloadResult> {
    this._aborted = false;
    this._paused = false;
    this._pauseQueue = [];
    this._consecutiveFailures = 0;
    this._abortController = new AbortController();
    this._keyCache.clear();
    this._initCache.clear();
    this._downloadedBytes = 0;
    this._speedWrite = 0;
    this._speedCount = 0;

    this.onStatus(this.msgs.fetchingPlaylist);
    const text = await this.retry(() => this.fetchText(m3u8Url));
    const isMpd = this.detectMpd(m3u8Url, text);
    let playlist = isMpd ? MpdParser.parse(text, m3u8Url) : M3U8Parser.parse(text, m3u8Url);

    // ── Master playlist: quality selection ────────────────────────
    if (playlist.type === 'master') {
      if (playlist.streams.length === 0) throw new Error(this.msgs.noStreamsInMaster);
      const masterMediaTracks = playlist.mediaTracks;
      const chosen = this.onQualityChoice
        ? await this.onQualityChoice(playlist.streams)
        : playlist.streams[0];
      const label = chosen.resolution || `${Math.round(chosen.bandwidth / 1000)}k`;
      this.onStatus(this.msgs.fetchingStream(label));
      if (isMpd) {
        // For MPD masters, the stream URL is the media URL directly
        const mediaText = await this.retry(() => this.fetchText(chosen.url));
        playlist = MpdParser.parse(mediaText, chosen.url);
      } else {
        const subtitleTracks = masterMediaTracks.filter((t) => t.type === 'SUBTITLES');
        playlist = M3U8Parser.parse(
          await this.retry(() => this.fetchText(chosen.url)),
          chosen.url,
          subtitleTracks,
        );
      }
    }

    if (playlist.type !== 'media' || playlist.segments.length === 0) {
      throw new Error(this.msgs.noSegmentsInMedia);
    }

    // Apply range selection
    const allSegs = playlist.segments;
    const start = Math.max(0, this.startIndex ?? 0);
    const end = Math.min(allSegs.length - 1, this.endIndex ?? allSegs.length - 1);
    const segments = allSegs.slice(start, end + 1);

    return this.downloadSegments(segments, filename, playlist.initSegment, playlist.isFmp4);
  }

  /** Download a pre-sliced segment list directly (used for range downloads). */
  async downloadSegments(
    segments: Segment[],
    filename: string,
    initSegment?: InitSegment,
    isFmp4 = false,
  ): Promise<DownloadResult> {
    if (!this._abortController) this._abortController = new AbortController();

    // ── fMP4 init segment (with cache) ────────────────────────────
    let initBuffer: ArrayBuffer | null = null;
    if (initSegment) {
      const cached = this._initCache.get(initSegment.url);
      if (cached) {
        initBuffer = cached;
      } else {
        this.onStatus(this.msgs.fetchingInitSegment);
        initBuffer = await this.retry(() => this.fetchBinary(initSegment.url, initSegment.byteRange));
        this._initCache.set(initSegment.url, initBuffer);
      }
    }

    const total = segments.length;
    const dur = M3U8Parser.formatDuration(segments.reduce((s, x) => s + x.duration, 0));
    const fmt = isFmp4 ? 'fMP4' : 'TS';
    this.onStatus(this.msgs.segmentInfo(total, fmt, dur), 'ok');

    // Save state for later retry / savePartial
    this._pendingSegments = segments;
    this._pendingInitBuffer = initBuffer;
    this._pendingIsFmp4 = isFmp4;
    this._pendingFilename = filename;
    this._segStatuses = new Array<SegmentStatus>(total).fill('pending');
    this._buffers = new Array<ArrayBuffer | null>(total).fill(null);

    // Notify total count so the UI can initialise the segment grid
    this.onSegmentCount?.(total);

    // ── Restore from IndexedDB cache (resume support) ──────────────
    let done = 0;
    if (this.cacheKey) {
      // Persist total so the resume UI can show progress before playlist parse
      cacheTotalCount(this.cacheKey, total).catch(() => {});
      try {
        const cached = await loadCachedSegments(this.cacheKey, total);
        if (cached.size > 0) {
          this.onStatus(this.msgs.restoredFromCache(cached.size), 'ok');
          for (const [idx, buf] of cached) {
            this._buffers[idx] = buf;
            this._segStatuses[idx] = 'ok';
            done++;
            // Notify UI for each restored segment (incremental update)
            this.onSegmentStatus?.(idx, 'ok');
          }
        }
      } catch (e) {
        // Cache unavailable — warn and start fresh
        this.onStatus(`Resume cache unavailable: ${(e as Error)?.message ?? e}`, 'warn');
      }
    }

    if (done > 0) {
      this.onProgress(done / total, done, total, 0, this._downloadedBytes);
    }

    // ── Concurrent download ────────────────────────────────────────
    await this.pool(total, async (i) => {
      // Skip segments already restored from cache
      if (this._segStatuses[i] === 'ok') return;
      if (this._aborted) throw new Error(ABORT_MSG);
      try {
        this._buffers[i] = await this.downloadSegment(segments[i]);
        this._segStatuses[i] = 'ok';
        done++;
        // Persist to cache for future resume
        if (this.cacheKey) {
          cacheSegment(this.cacheKey, i, this._buffers[i]!).catch(() => {});
        }
        this.onProgress(done / total, done, total, this._calcSpeed(), this._downloadedBytes);
        this.onSegmentStatus?.(i, 'ok');
        this._consecutiveFailures = 0; // reset on success
      } catch (e) {
        // Re-throw abort; swallow other errors and mark segment failed
        if (this._aborted || (e instanceof Error && e.message === ABORT_MSG)) {
          throw new Error(ABORT_MSG);
        }
        this._segStatuses[i] = 'failed';
        this.onSegmentStatus?.(i, 'failed');
        this.onStatus(this.msgs.segmentFailed(i + 1), 'warn');
        // ── Circuit breaker ──────────────────────────────────────────
        // Abort early if too many consecutive segments fail, preventing
        // pointless retries against an unresponsive CDN.
        if (
          this.circuitBreakerThreshold > 0 &&
          ++this._consecutiveFailures >= this.circuitBreakerThreshold
        ) {
          this.onStatus(this.msgs.circuitOpen(this._consecutiveFailures), 'error');
          this.abort();
          throw new Error(ABORT_MSG);
        }
      }
    });

    if (this._aborted) throw new Error(ABORT_MSG);

    // ── Check for failures ─────────────────────────────────────────
    const failedCount = this._segStatuses.filter((s) => s === 'failed').length;
    if (failedCount > 0) {
      this.onStatus(this.msgs.someSegmentsFailed(failedCount), 'error');
      throw new PartialDownloadError(failedCount);
    }

    // ── Merge and save ─────────────────────────────────────────────
    this.onPhaseChange?.('merging');
    this.onStatus(this.msgs.merging);
    return this.mergeAndSave(this._buffers, filename, initBuffer, isFmp4, total);
  }

  /**
   * Re-download all failed segments, then merge and save.
   * Only valid after a PartialDownloadError from download/downloadSegments.
   */
  async retryFailed(): Promise<DownloadResult> {
    const failedIdx = this.failedIndices;
    if (failedIdx.length === 0) throw new Error(this.msgs.noFailedSegments);

    this._aborted = false;
    this._paused = false;
    this._pauseQueue = [];
    this._consecutiveFailures = 0;
    this._abortController = new AbortController();
    this._speedWrite = 0;
    this._speedCount = 0;

    const total = this._pendingSegments.length;
    let okCount = this._segStatuses.filter((s) => s === 'ok').length;

    this.onStatus(this.msgs.retryingFailed(failedIdx.length), 'info');

    // Mark all failed back to pending
    for (const i of failedIdx) {
      this._segStatuses[i] = 'pending';
      this.onSegmentStatus?.(i, 'pending');
    }

    // Reuse pool() — iterate over positions in failedIdx, not over all segments
    await this.pool(failedIdx.length, async (pos) => {
      if (this._aborted) throw new Error(ABORT_MSG);
      const i = failedIdx[pos];
      try {
        this._buffers[i] = await this.downloadSegment(this._pendingSegments[i]);
        this._segStatuses[i] = 'ok';
        okCount++;
        if (this.cacheKey) {
          cacheSegment(this.cacheKey, i, this._buffers[i]!).catch(() => {});
        }
        this.onProgress(
          okCount / total,
          okCount,
          total,
          this._calcSpeed(),
          this._downloadedBytes,
        );
        this.onSegmentStatus?.(i, 'ok');
      } catch (e) {
        if (this._aborted || (e instanceof Error && e.message === ABORT_MSG)) {
          throw new Error(ABORT_MSG);
        }
        this._segStatuses[i] = 'failed';
        this.onSegmentStatus?.(i, 'failed');
        this.onStatus(this.msgs.segmentRetryFailed(i + 1), 'warn');
      }
    });

    if (this._aborted) throw new Error(ABORT_MSG);

    const stillFailed = this._segStatuses.filter((s) => s === 'failed').length;
    if (stillFailed > 0) {
      this.onStatus(this.msgs.stillFailed(stillFailed), 'error');
      throw new PartialDownloadError(stillFailed);
    }

    this.onPhaseChange?.('merging');
    this.onStatus(this.msgs.retryComplete, 'ok');
    return this.mergeAndSave(
      this._buffers,
      this._pendingFilename,
      this._pendingInitBuffer,
      this._pendingIsFmp4,
      total,
    );
  }

  /**
   * Save only the segments that have already succeeded.
   * Safe to call during an active download or after a PartialDownloadError.
   * The filename will have "_partial" appended before the extension.
   */
  async savePartial(filenameOverride?: string): Promise<void> {
    const fn = filenameOverride ?? this._pendingFilename;
    const okBuffers = this._segStatuses
      .map((s, i) => (s === 'ok' ? this._buffers[i] : null))
      .filter((b): b is ArrayBuffer => b !== null);

    if (okBuffers.length === 0) throw new Error(this.msgs.noOkSegments);

    this.onStatus(this.msgs.savingPartial(okBuffers.length), 'info');

    const parts: Blob[] = [];
    if (this._pendingInitBuffer) parts.push(new Blob([this._pendingInitBuffer]));
    for (let i = 0; i < okBuffers.length; i += MERGE_BATCH) {
      parts.push(new Blob(okBuffers.slice(i, i + MERGE_BATCH)));
    }
    const ext = this._pendingIsFmp4 ? 'mp4' : 'ts';
    const mimeType = this._pendingIsFmp4 ? 'video/mp4' : 'video/mp2t';
    const blob = new Blob(parts, { type: mimeType });
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    await this.saveBlob(blob, `${fn}_partial.${ext}`);
    this.onStatus(this.msgs.savedPartial(okBuffers.length, mb), 'ok');
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async mergeAndSave(
    buffers: Array<ArrayBuffer | null>,
    filename: string,
    initBuffer: ArrayBuffer | null,
    isFmp4: boolean,
    totalSegments: number,
  ): Promise<DownloadResult> {
    const valid = buffers.filter((b): b is ArrayBuffer => b !== null);
    const parts: Blob[] = [];
    if (initBuffer) parts.push(new Blob([initBuffer]));
    for (let i = 0; i < valid.length; i += MERGE_BATCH) {
      parts.push(new Blob(valid.slice(i, i + MERGE_BATCH)));
    }

    // Release ArrayBuffer references now that Blobs have been constructed.
    // This allows the GC to reclaim memory before the (potentially slow) remux step.
    this._buffers = [];

    let ext: string;
    let finalBlob: Blob;

    if (isFmp4) {
      // Already fMP4 — save directly
      ext = 'mp4';
      finalBlob = new Blob(parts, { type: 'video/mp4' });
    } else if (this.convertToMp4) {
      // TS → fMP4 remux
      this.onStatus(this.msgs.convertingMp4, 'info');
      let tsBlob: Blob | null = new Blob(parts, { type: 'video/mp2t' });
      try {
        finalBlob = await remuxTsToMp4(tsBlob);
        tsBlob = null; // release reference
        ext = 'mp4';
        this.onStatus(this.msgs.mp4ConvertDone, 'ok');
      } catch (e) {
        this.onStatus(this.msgs.mp4ConvertFailed((e as Error).message), 'warn');
        finalBlob = tsBlob!;
        tsBlob = null;
        ext = 'ts';
      }
    } else {
      ext = 'ts';
      finalBlob = new Blob(parts, { type: 'video/mp2t' });
    }

    this.onStatus(this.msgs.prepareSave);
    await this.saveBlob(finalBlob, `${filename}.${ext}`);
    // Clear the segment cache now that the file has been saved
    if (this.cacheKey) {
      clearCachedSegments(this.cacheKey).catch(() => {});
    }
    const mb = (finalBlob.size / 1024 / 1024).toFixed(2);
    this.onStatus(this.msgs.downloadComplete(totalSegments, mb), 'ok');
    return { bytes: finalBlob.size, segments: totalSegments, ext };
  }

  private async downloadSegment(seg: Segment): Promise<ArrayBuffer> {
    const data = await this.retry(() => this.fetchBinary(seg.url, seg.byteRange));
    if (seg.encryption?.method === 'AES-128') return this.decryptAES128(data, seg);
    return data;
  }

  private async decryptAES128(data: ArrayBuffer, seg: Segment): Promise<ArrayBuffer> {
    const { uri, iv } = seg.encryption!;
    if (!uri) throw new Error(this.msgs.aes128MissingKey);
    let key = this._keyCache.get(uri);
    if (!key) {
      const keyBytes = new Uint8Array(await this.retry(() => this.fetchBinary(uri)));
      key = await importAesKey(keyBytes);
      this._keyCache.set(uri, key);
    }
    return aesDecrypt(data, key, iv ?? seqToIV(seg.sequence));
  }

  private async pool(count: number, worker: (i: number) => Promise<void>) {
    let cursor = 0;
    const run = async () => {
      while (!this._aborted) {
        // Pause check first; yields control without advancing the cursor.
        await this._waitIfPaused();
        // Read and increment cursor synchronously (no await in between) so
        // concurrent workers never see the same index after the pause gate.
        if (this._aborted || cursor >= count) break;
        const i = cursor++;
        await worker(i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, count) }, run));
  }

  /** Suspends the caller until resume() is called (or abort() unblocks it). */
  private _waitIfPaused(): Promise<void> {
    if (!this._paused) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this._pauseQueue.push(resolve);
    });
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this.retries; i++) {
      if (this._aborted) throw new Error(ABORT_MSG);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error(ABORT_MSG);
        // Permanent errors (403, 404) will never succeed — rethrow immediately.
        if (e instanceof HttpError && e.permanent) throw e;
        lastErr = e;
        if (i < this.retries - 1) {
          // 429: honour Retry-After header; otherwise use exponential backoff with jitter
          const retryAfterMs = (e as HttpError).retryAfterMs;
          const delay =
            retryAfterMs != null
              ? retryAfterMs
              : Math.min(800 * Math.pow(2, i), 30_000) + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  private async fetchText(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { credentials: 'include', signal: this._fetchSignal() });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error(ABORT_MSG);
      throw new Error(this.msgs.networkError(this.shortUrl(url)));
    }
    if (!res.ok) throw this.classifyHttpError(res, url);
    return res.text();
  }

  private async fetchBinary(url: string, byteRange?: ByteRange): Promise<ArrayBuffer> {
    const headers: HeadersInit = byteRange
      ? { Range: `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}` }
      : {};
    let res: Response;
    try {
      res = await fetch(url, {
        credentials: 'include',
        headers,
        signal: this._fetchSignal(),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error(ABORT_MSG);
      throw new Error(this.msgs.networkError(this.shortUrl(url)));
    }
    if (!res.ok && res.status !== 206) throw this.classifyHttpError(res, url);
    const buf = await res.arrayBuffer();
    this._downloadedBytes += buf.byteLength;
    this._recordSpeedSample();
    return buf;
  }

  private classifyHttpError(res: Response, url: string): HttpError {
    const { status } = res;
    const u = this.shortUrl(url);
    if (status === 403) return new HttpError(this.msgs.http403(u), { permanent: true });
    if (status === 404) return new HttpError(this.msgs.http404(u), { permanent: true });
    if (status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      let retryAfterMs: number | undefined;
      if (retryAfterHeader) {
        const seconds = parseFloat(retryAfterHeader);
        if (!isNaN(seconds)) {
          retryAfterMs = Math.min(seconds * 1000, 60_000);
        }
      }
      return new HttpError(this.msgs.http429(u), { retryAfterMs });
    }
    if (status >= 500) return new HttpError(this.msgs.httpServer(status, u));
    return new HttpError(this.msgs.httpGeneric(status, u));
  }

  private detectMpd(url: string, text: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.endsWith('.mpd')) return true;
    } catch {}
    return text.trimStart().startsWith('<?xml') && text.includes('<MPD');
  }

  private shortUrl(url: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 40 ? '…' + u.pathname.slice(-35) : u.pathname;
      return u.hostname + path;
    } catch {
      return url.slice(0, 60);
    }
  }

  private _recordSpeedSample() {
    const SIZE = M3U8Downloader.SPEED_BUF_SIZE;
    const slot = this._speedWrite % SIZE;
    this._speedBuf[slot * 2] = Date.now();
    this._speedBuf[slot * 2 + 1] = this._downloadedBytes;
    this._speedWrite = (this._speedWrite + 1) % SIZE;
    if (this._speedCount < SIZE) this._speedCount++;
  }

  private _calcSpeed(): number {
    if (this._speedCount < 2) return 0;
    const SIZE = M3U8Downloader.SPEED_BUF_SIZE;
    const count = this._speedCount;
    const now = Date.now();
    const cutoff = now - 4_000;

    // Walk backwards from the most recent sample to find the oldest one
    // within the 4-second window, all within the ring buffer — O(N) but N ≤ 60.
    const latestSlot = ((this._speedWrite - 1) + SIZE) % SIZE;
    let oldestSlot = latestSlot;
    for (let i = 1; i < count; i++) {
      const slot = ((this._speedWrite - 1 - i) + SIZE) % SIZE;
      if (this._speedBuf[slot * 2] < cutoff) break;
      oldestSlot = slot;
    }
    if (oldestSlot === latestSlot) return 0;

    const dt = (this._speedBuf[latestSlot * 2] - this._speedBuf[oldestSlot * 2]) / 1000;
    if (dt < 0.1) return 0;
    return (this._speedBuf[latestSlot * 2 + 1] - this._speedBuf[oldestSlot * 2 + 1]) / dt;
  }

  /**
   * Returns an AbortSignal that fires on either a user abort or a per-request
   * timeout, whichever comes first.  A fresh timeout is created on every call
   * so each fetch() gets its own independent deadline.
   */
  private _fetchSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.fetchTimeout);
    if (this._abortController) {
      return AbortSignal.any([this._abortController.signal, timeout]);
    }
    return timeout;
  }

  async saveBlob(blob: Blob, filename: string): Promise<void> {
    if (this.onSaveBlob) {
      return this.onSaveBlob(blob, filename);
    }
    await M3U8Downloader._saveBlobDefault(blob, filename);
  }

  /**
   * Built-in save implementation: uses `chrome.downloads` when available,
   * falls back to an `<a download>` click for non-extension environments.
   * Exposed as a static so callers (e.g. LiveRecorder via helper instance)
   * can reuse it without constructing a full downloader.
   */
  static async _saveBlobDefault(blob: Blob, filename: string): Promise<void> {
    const blobUrl = URL.createObjectURL(blob);
    try {
      const downloadId = await chrome.downloads.download({ url: blobUrl, filename });
      // Revoke only after the browser has fully read the blob (complete or interrupted),
      // not on a fixed timeout that is too short for large files.
      const cleanup = () => {
        URL.revokeObjectURL(blobUrl);
        chrome.downloads.onChanged.removeListener(revoke);
        clearTimeout(timeoutId);
      };
      const revoke = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
          cleanup();
        }
      };
      chrome.downloads.onChanged.addListener(revoke);
      // Safety net: revoke after 10 minutes even if the download event never fires
      // (e.g. browser crash or Service Worker restart).
      const timeoutId = setTimeout(cleanup, 600_000);
    } catch {
      const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }
  }
}
