import { M3U8Parser } from './m3u8-parser';
import type { Segment } from './types';
import { M3U8Downloader } from './downloader';
import { aesDecrypt, importAesKey, seqToIV } from './crypto-utils';
import { ZH_RECORDER_MESSAGES } from './default-messages';

/** All user-visible status messages emitted by the live recorder.
 *  Pass a translated object via `LiveRecorderOptions.messages` to support i18n. */
export interface LiveRecorderMessages {
  startRecording: string;
  playlistFailed: (status: number) => string;
  fetchFailed: (msg: string) => string;
  streamEnded: string;
  segmentFailed: (err: string, url: string) => string;
  mergingRecording: string;
  recordingDone: (count: number, mb: string) => string;
  aes128MissingKey: string;
  keyFetchFailed: (status: number) => string;
}


export interface LiveRecorderOptions {
  concurrency?: number;
  retries?: number;
  /** Translated status messages. Defaults to Chinese if not provided. */
  messages?: LiveRecorderMessages;
  onSegmentDone?: (count: number, durationSec: number, bufferedBytes: number) => void;
  onStatus?: (msg: string, type?: 'info' | 'ok' | 'error') => void;
}

export class LiveRecorder {
  private concurrency: number;
  private retries: number;
  private msgs: LiveRecorderMessages;
  private onSegmentDone: NonNullable<LiveRecorderOptions['onSegmentDone']>;
  private onStatus: NonNullable<LiveRecorderOptions['onStatus']>;

  private _stopping = false;
  private _abortController = new AbortController();
  private _chunks: Blob[] = []; // intermediate Blobs flushed every N segments
  private _pending: ArrayBuffer[] = [];
  private _segCount = 0;
  private _durationSec = 0;
  private _bufferedBytes = 0;
  private readonly FLUSH_EVERY = 100;
  // Dynamic polling: tracks consecutive empty polls
  private _emptyPollCount = 0;
  // AES-128 key cache: uri → CryptoKey
  private _keyCache = new Map<string, CryptoKey>();

  constructor(opts: LiveRecorderOptions = {}) {
    this.concurrency = opts.concurrency ?? 4;
    this.retries = opts.retries ?? 3;
    this.msgs = opts.messages ?? ZH_RECORDER_MESSAGES;
    this.onSegmentDone = opts.onSegmentDone ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
  }

  stop() {
    this._stopping = true;
    this._abortController.abort();
  }

  async record(m3u8Url: string): Promise<void> {
    // Track the highest sequence number processed so far.
    // Using EXT-X-MEDIA-SEQUENCE is more reliable than URL-based deduplication
    // because CDNs sometimes rotate segment URLs for the same content.
    // -1 means "nothing seen yet" — any non-negative sequence passes the filter.
    let lastSeenSequence = -1;

    this._emptyPollCount = 0;
    this._keyCache.clear();
    this.onStatus(this.msgs.startRecording, 'ok');

    while (!this._stopping) {
      let text: string | null = null;
      try {
        const res = await fetch(m3u8Url, {
          credentials: 'include',
          signal: this._abortController.signal,
        });
        if (res.ok) text = await res.text();
        else this.onStatus(this.msgs.playlistFailed(res.status), 'error');
      } catch (e) {
        if (this._stopping) break;
        // AbortError is expected when stop() is called; only log unexpected errors
        if ((e as Error)?.name !== 'AbortError') {
          const msg = e instanceof Error ? e.message : String(e);
          this.onStatus(this.msgs.fetchFailed(msg), 'error');
        }
        await this._wait(3000);
        continue;
      }

      if (!text) {
        await this._wait(3000);
        continue;
      }

      const playlist = M3U8Parser.parse(text, m3u8Url);
      if (playlist.type !== 'media') break;

      const targetDuration = playlist.targetDuration || 5;

      // Filter to segments not yet processed using sequence numbers (O(1) per segment).
      const newSegs = playlist.segments.filter((s) => s.sequence > lastSeenSequence);

      if (playlist.isEndList) {
        // Process any remaining new segments before exiting.
        if (newSegs.length > 0) {
          lastSeenSequence = newSegs[newSegs.length - 1].sequence;
          await this._downloadConcurrent(newSegs);
        }
        this.onStatus(this.msgs.streamEnded, 'ok');
        break;
      }

      if (newSegs.length === 0) {
        // No new segments — back off exponentially (max targetDuration)
        this._emptyPollCount++;
        if (this._stopping) break;
        // Start at targetDuration * 125ms so it takes ~4 steps to reach the
        // full targetDuration cap (vs. the previous 500ms start that capped at step 2).
        // Steps (targetDuration=5s): 625ms → 1250ms → 2500ms → 5000ms
        const backoff = Math.min(
          (targetDuration * 125) * Math.pow(2, this._emptyPollCount - 1),
          targetDuration * 1000,
        );
        await this._wait(backoff);
        continue;
      }

      // Got new segments — advance sequence cursor, reset backoff, download concurrently.
      // Advance lastSeenSequence before launching downloads so that concurrent
      // polls (if any) don't re-queue the same segments.
      lastSeenSequence = newSegs[newSegs.length - 1].sequence;
      this._emptyPollCount = 0;
      await this._downloadConcurrent(newSegs);

      if (this._stopping) break;

      // Wait half targetDuration before re-polling (HLS spec recommendation)
      await this._wait(targetDuration * 500);
    }
  }

  async saveAs(filename: string): Promise<{ bytes: number; segments: number }> {
    this.onStatus(this.msgs.mergingRecording);
    this._flush(); // flush remaining pending

    const mimeType = 'video/mp2t';
    const blob = new Blob(this._chunks, { type: mimeType });

    const helper = new M3U8Downloader();
    await helper.saveBlob(blob, `${filename}.ts`);

    const mb = (blob.size / 1024 / 1024).toFixed(2);
    this.onStatus(this.msgs.recordingDone(this._segCount, mb), 'ok');
    return { bytes: blob.size, segments: this._segCount };
  }

  /**
   * Download a batch of segments concurrently (up to `this.concurrency` at a
   * time), then append the results in the *original segment order* so the
   * output stream stays well-formed.
   */
  private async _downloadConcurrent(segs: Segment[]): Promise<void> {
    if (segs.length === 0) return;
    const results: Array<ArrayBuffer | null> = new Array(segs.length).fill(null);
    let cursor = 0;

    const worker = async () => {
      while (cursor < segs.length && !this._stopping) {
        const idx = cursor++;
        results[idx] = await this._downloadSegment(segs[idx]);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, segs.length) }, worker),
    );

    // Append in order so the byte stream is sequentially correct
    for (let i = 0; i < segs.length; i++) {
      const buf = results[i];
      if (!buf) continue;
      this._pending.push(buf);
      this._segCount++;
      this._durationSec += segs[i].duration;
      this._bufferedBytes += buf.byteLength;
      this.onSegmentDone(this._segCount, this._durationSec, this._bufferedBytes);
      if (this._pending.length >= this.FLUSH_EVERY) this._flush();
    }
  }

  private _flush() {
    if (this._pending.length === 0) return;
    this._chunks.push(new Blob(this._pending));
    this._pending = [];
  }

  private async _downloadSegment(seg: Segment): Promise<ArrayBuffer | null> {
    let lastError = '';
    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const headers: HeadersInit = seg.byteRange
          ? {
              Range: `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`,
            }
          : {};
        // Intentionally NOT using _abortController.signal here so that
        // in-flight segment downloads complete even after stop() is called,
        // preventing data loss at the end of a recording session.
        const res = await fetch(seg.url, { credentials: 'include', headers });
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        // Decrypt AES-128 encrypted segments if needed
        if (seg.encryption?.method === 'AES-128') {
          return await this._decryptAES128(data, seg);
        }
        return data;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < this.retries - 1)
          await this._wait(Math.min(800 * Math.pow(2, attempt), 10_000));
      }
    }
    this.onStatus(this.msgs.segmentFailed(lastError, seg.url.slice(-40)), 'error');
    return null;
  }

  /** Decrypt an AES-128 encrypted segment buffer. Keys are cached by URI. */
  private async _decryptAES128(data: ArrayBuffer, seg: Segment): Promise<ArrayBuffer> {
    const { uri, iv } = seg.encryption!;
    if (!uri) throw new Error(this.msgs.aes128MissingKey);
    let key = this._keyCache.get(uri);
    if (!key) {
      let lastStatus = 0;
      for (let attempt = 0; attempt < this.retries; attempt++) {
        const res = await fetch(uri, { credentials: 'include' });
        if (res.ok) {
          key = await importAesKey(new Uint8Array(await res.arrayBuffer()));
          this._keyCache.set(uri, key);
          break;
        }
        lastStatus = res.status;
        if (attempt < this.retries - 1)
          await this._wait(Math.min(800 * Math.pow(2, attempt), 5_000));
      }
      if (!key) throw new Error(this.msgs.keyFetchFailed(lastStatus));
    }
    return aesDecrypt(data, key, iv ?? seqToIV(seg.sequence));
  }

  private _wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
