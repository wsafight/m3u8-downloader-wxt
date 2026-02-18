import { M3U8Parser } from './m3u8-parser';
import type { Segment } from './types';
import { M3U8Downloader } from './downloader';

export interface LiveRecorderOptions {
  concurrency?: number;
  retries?: number;
  onSegmentDone?: (count: number, durationSec: number, bufferedBytes: number) => void;
  onStatus?: (msg: string, type?: 'info' | 'ok' | 'error') => void;
}

export class LiveRecorder {
  private concurrency: number;
  private retries: number;
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

  constructor(opts: LiveRecorderOptions = {}) {
    this.concurrency = opts.concurrency ?? 4;
    this.retries = opts.retries ?? 3;
    this.onSegmentDone = opts.onSegmentDone ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
  }

  stop() {
    this._stopping = true;
    this._abortController.abort();
  }

  async record(m3u8Url: string): Promise<void> {
    const seen = new Set<string>();
    this._emptyPollCount = 0;
    this.onStatus('开始录制直播流…', 'ok');

    while (!this._stopping) {
      let text: string | null = null;
      try {
        const res = await fetch(m3u8Url, {
          credentials: 'include',
          signal: this._abortController.signal,
        });
        if (res.ok) text = await res.text();
        else this.onStatus(`播放列表请求失败：HTTP ${res.status}，3 秒后重试`, 'error');
      } catch (e) {
        if (this._stopping) break;
        // AbortError is expected when stop() is called; only log unexpected errors
        if ((e as Error)?.name !== 'AbortError') {
          const msg = e instanceof Error ? e.message : String(e);
          this.onStatus(`拉取播放列表失败：${msg}，3 秒后重试`, 'error');
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

      if (playlist.isEndList) {
        // Process any new segments before exiting
        for (const seg of playlist.segments.filter((s) => !seen.has(s.url))) {
          seen.add(seg.url);
          const buf = await this._downloadSegment(seg);
          if (!buf) continue;
          this._pending.push(buf);
          this._segCount++;
          this._durationSec += seg.duration;
          this._bufferedBytes += buf.byteLength;
          this.onSegmentDone(this._segCount, this._durationSec, this._bufferedBytes);
          if (this._pending.length >= this.FLUSH_EVERY) this._flush();
        }
        this.onStatus('直播流已结束', 'ok');
        break;
      }

      const newSegs = playlist.segments.filter((s) => !seen.has(s.url));

      if (newSegs.length === 0) {
        // No new segments — back off exponentially (max targetDuration)
        this._emptyPollCount++;
        if (this._stopping) break;
        const backoff = Math.min(
          (targetDuration * 500) * Math.pow(2, this._emptyPollCount - 1),
          targetDuration * 1000,
        );
        await this._wait(backoff);
        continue;
      }

      // Got new segments — reset backoff
      this._emptyPollCount = 0;

      for (const seg of newSegs) {
        if (this._stopping) break;
        seen.add(seg.url);
        // NOTE: segment fetch does NOT use _abortController — we allow in-flight
        // segments to complete so no data is lost when stop() is called.
        const buf = await this._downloadSegment(seg);
        if (!buf) continue;
        this._pending.push(buf);
        this._segCount++;
        this._durationSec += seg.duration;
        this._bufferedBytes += buf.byteLength;
        this.onSegmentDone(this._segCount, this._durationSec, this._bufferedBytes);
        if (this._pending.length >= this.FLUSH_EVERY) this._flush();
      }

      if (this._stopping) break;

      // Wait half targetDuration before re-polling (HLS spec recommendation)
      await this._wait(targetDuration * 500);
    }
  }

  async saveAs(filename: string): Promise<{ bytes: number; segments: number }> {
    this.onStatus('正在合并录制内容…');
    this._flush(); // flush remaining pending

    const mimeType = 'video/mp2t';
    const blob = new Blob(this._chunks, { type: mimeType });

    const helper = new M3U8Downloader();
    await helper.saveBlob(blob, `${filename}.ts`);

    const mb = (blob.size / 1024 / 1024).toFixed(2);
    this.onStatus(`录制完成！${this._segCount} 片，${mb} MB`, 'ok');
    return { bytes: blob.size, segments: this._segCount };
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
        return await res.arrayBuffer();
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < this.retries - 1) await this._wait(800 * (attempt + 1));
      }
    }
    this.onStatus(`分片下载失败（${lastError}），已跳过: ${seg.url.slice(-40)}`, 'error');
    return null;
  }

  private _wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
