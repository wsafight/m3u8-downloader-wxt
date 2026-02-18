import { M3U8Parser } from './m3u8-parser';
import { remuxTsToMp4 } from './remux';
import type { ByteRange, InitSegment, Segment, SegmentStatus, StreamDef } from './types';

export interface DownloaderOptions {
  concurrency?: number;
  retries?: number;
  startIndex?: number; // inclusive, for range downloads
  endIndex?: number; // inclusive, for range downloads
  convertToMp4?: boolean; // remux TS → fMP4 after download
  onProgress?: (
    ratio: number,
    done: number,
    total: number,
    speedBps: number,
    downloadedBytes: number,
  ) => void;
  onStatus?: (msg: string, type?: 'info' | 'ok' | 'warn' | 'error') => void;
  onQualityChoice?: (streams: StreamDef[]) => Promise<StreamDef>;
  onSegmentStatus?: (statuses: readonly SegmentStatus[]) => void;
}

export interface DownloadResult {
  bytes: number;
  segments: number;
  ext: string; // 'ts' or 'mp4'
}

export class PartialDownloadError extends Error {
  constructor(public readonly failedCount: number) {
    super(`${failedCount} 个分片下载失败`);
    this.name = 'PartialDownloadError';
  }
}

const MERGE_BATCH = 100;

export class M3U8Downloader {
  private concurrency: number;
  private retries: number;
  private startIndex: number | undefined;
  private endIndex: number | undefined;
  private convertToMp4: boolean;
  private onProgress: NonNullable<DownloaderOptions['onProgress']>;
  private onStatus: NonNullable<DownloaderOptions['onStatus']>;
  private onQualityChoice: DownloaderOptions['onQualityChoice'];
  private onSegmentStatus: DownloaderOptions['onSegmentStatus'];
  private _aborted = false;
  private _abortController: AbortController | null = null;
  private _keyCache = new Map<string, CryptoKey>();
  // Speed tracking
  private _downloadedBytes = 0;
  private _speedSamples: { t: number; cumBytes: number }[] = [];

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
    this.onProgress = opts.onProgress ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
    this.onQualityChoice = opts.onQualityChoice;
    this.onSegmentStatus = opts.onSegmentStatus;
  }

  abort() {
    this._aborted = true;
    this._abortController?.abort();
  }

  /** Current per-segment statuses (snapshot copy). */
  get segmentStatuses(): readonly SegmentStatus[] {
    return [...this._segStatuses];
  }

  /** Indices of segments that failed in the last download. */
  get failedIndices(): number[] {
    return this._segStatuses
      .map((s, i) => (s === 'failed' ? i : -1))
      .filter((i): i is number => i !== -1);
  }

  async download(m3u8Url: string, filename = 'video'): Promise<DownloadResult> {
    this._aborted = false;
    this._abortController = new AbortController();
    this._keyCache.clear();
    this._downloadedBytes = 0;
    this._speedSamples = [];

    this.onStatus('正在获取播放列表…');
    const text = await this.retry(() => this.fetchText(m3u8Url));
    let playlist = M3U8Parser.parse(text, m3u8Url);

    // ── Master playlist: quality selection ────────────────────────
    if (playlist.type === 'master') {
      if (playlist.streams.length === 0) throw new Error('Master playlist 中没有可用流');
      const chosen = this.onQualityChoice
        ? await this.onQualityChoice(playlist.streams)
        : playlist.streams[0];
      const label = chosen.resolution || `${Math.round(chosen.bandwidth / 1000)}k`;
      this.onStatus(`获取媒体流 (${label})…`);
      playlist = M3U8Parser.parse(await this.retry(() => this.fetchText(chosen.url)), chosen.url);
    }

    if (playlist.type !== 'media' || playlist.segments.length === 0) {
      throw new Error('媒体播放列表中没有分片');
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

    // ── fMP4 init segment ──────────────────────────────────────────
    let initBuffer: ArrayBuffer | null = null;
    if (initSegment) {
      this.onStatus('获取初始化分片…');
      initBuffer = await this.retry(() => this.fetchBinary(initSegment.url, initSegment.byteRange));
    }

    const total = segments.length;
    const dur = M3U8Parser.formatDuration(segments.reduce((s, x) => s + x.duration, 0));
    const fmt = isFmp4 ? 'fMP4' : 'TS';
    this.onStatus(`共 ${total} 个分片 (${fmt})，时长约 ${dur}，开始并发下载…`, 'ok');

    // Save state for later retry / savePartial
    this._pendingSegments = segments;
    this._pendingInitBuffer = initBuffer;
    this._pendingIsFmp4 = isFmp4;
    this._pendingFilename = filename;
    this._segStatuses = new Array<SegmentStatus>(total).fill('pending');
    this._buffers = new Array<ArrayBuffer | null>(total).fill(null);

    // Notify initial statuses
    this.onSegmentStatus?.([...this._segStatuses]);

    // ── Concurrent download ────────────────────────────────────────
    let done = 0;

    await this.pool(total, async (i) => {
      if (this._aborted) throw new Error('已中止');
      try {
        this._buffers[i] = await this.downloadSegment(segments[i]);
        this._segStatuses[i] = 'ok';
        done++;
        this.onProgress(done / total, done, total, this._calcSpeed(), this._downloadedBytes);
        this.onSegmentStatus?.([...this._segStatuses]);
      } catch (e) {
        // Re-throw abort; swallow other errors and mark segment failed
        if (this._aborted || (e instanceof Error && e.message === '已中止')) {
          throw new Error('已中止');
        }
        this._segStatuses[i] = 'failed';
        this.onSegmentStatus?.([...this._segStatuses]);
        this.onStatus(`分片 ${i + 1} 下载失败`, 'warn');
      }
    });

    if (this._aborted) throw new Error('已中止');

    // ── Check for failures ─────────────────────────────────────────
    const failedCount = this._segStatuses.filter((s) => s === 'failed').length;
    if (failedCount > 0) {
      this.onStatus(`${failedCount} 个分片失败，可点击"重新下载失败片段"重试`, 'error');
      throw new PartialDownloadError(failedCount);
    }

    // ── Merge and save ─────────────────────────────────────────────
    this.onStatus('正在合并分片…');
    return this.mergeAndSave(this._buffers, filename, initBuffer, isFmp4, total);
  }

  /**
   * Re-download all failed segments, then merge and save.
   * Only valid after a PartialDownloadError from download/downloadSegments.
   */
  async retryFailed(): Promise<DownloadResult> {
    const failedIdx = this.failedIndices;
    if (failedIdx.length === 0) throw new Error('没有失败的分片');

    this._aborted = false;
    this._abortController = new AbortController();
    this._speedSamples = [];

    const total = this._pendingSegments.length;
    let okCount = this._segStatuses.filter((s) => s === 'ok').length;

    this.onStatus(`重试 ${failedIdx.length} 个失败分片…`, 'info');

    // Mark all failed back to pending
    for (const i of failedIdx) {
      this._segStatuses[i] = 'pending';
    }
    this.onSegmentStatus?.([...this._segStatuses]);

    // Pool over only the failed indices
    let cursor = 0;
    const run = async () => {
      while (cursor < failedIdx.length && !this._aborted) {
        const pos = cursor++;
        const i = failedIdx[pos];
        try {
          this._buffers[i] = await this.downloadSegment(this._pendingSegments[i]);
          this._segStatuses[i] = 'ok';
          okCount++;
          this.onProgress(
            okCount / total,
            okCount,
            total,
            this._calcSpeed(),
            this._downloadedBytes,
          );
          this.onSegmentStatus?.([...this._segStatuses]);
        } catch (e) {
          if (this._aborted || (e instanceof Error && e.message === '已中止')) {
            throw new Error('已中止');
          }
          this._segStatuses[i] = 'failed';
          this.onSegmentStatus?.([...this._segStatuses]);
          this.onStatus(`分片 ${i + 1} 重试失败`, 'warn');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, failedIdx.length) }, run));

    if (this._aborted) throw new Error('已中止');

    const stillFailed = this._segStatuses.filter((s) => s === 'failed').length;
    if (stillFailed > 0) {
      this.onStatus(`仍有 ${stillFailed} 个分片失败`, 'error');
      throw new PartialDownloadError(stillFailed);
    }

    this.onStatus('重试完成，正在合并…', 'ok');
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

    if (okBuffers.length === 0) throw new Error('没有已成功的分片');

    this.onStatus(`正在保存 ${okBuffers.length} 个已完成分片…`, 'info');

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
    this.onStatus(`已保存 ${okBuffers.length} 个分片（${mb} MB）`, 'ok');
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
      for (let j = i; j < Math.min(i + MERGE_BATCH, valid.length); j++) {
        (valid as (ArrayBuffer | null)[])[j] = null;
      }
    }

    let ext: string;
    let finalBlob: Blob;

    if (isFmp4) {
      // Already fMP4 — save directly
      ext = 'mp4';
      finalBlob = new Blob(parts, { type: 'video/mp4' });
    } else if (this.convertToMp4) {
      // TS → fMP4 remux
      this.onStatus('正在转换为 MP4…', 'info');
      const tsBlob = new Blob(parts, { type: 'video/mp2t' });
      try {
        finalBlob = await remuxTsToMp4(tsBlob);
        ext = 'mp4';
        this.onStatus('MP4 转换完成', 'ok');
      } catch (e) {
        this.onStatus(`MP4 转换失败（${(e as Error).message}），将保存为 .ts`, 'warn');
        finalBlob = tsBlob;
        ext = 'ts';
      }
    } else {
      ext = 'ts';
      finalBlob = new Blob(parts, { type: 'video/mp2t' });
    }

    this.onStatus('准备保存文件…');
    await this.saveBlob(finalBlob, `${filename}.${ext}`);
    const mb = (finalBlob.size / 1024 / 1024).toFixed(2);
    this.onStatus(`下载完成！${totalSegments} 个分片，${mb} MB`, 'ok');
    return { bytes: finalBlob.size, segments: totalSegments, ext };
  }

  private async downloadSegment(seg: Segment): Promise<ArrayBuffer> {
    const data = await this.retry(() => this.fetchBinary(seg.url, seg.byteRange));
    if (seg.encryption?.method === 'AES-128') return this.decryptAES128(data, seg);
    return data;
  }

  private async decryptAES128(data: ArrayBuffer, seg: Segment): Promise<ArrayBuffer> {
    const { uri, iv } = seg.encryption!;
    if (!uri) throw new Error('AES-128 加密但缺少密钥 URI');
    let key = this._keyCache.get(uri);
    if (!key) {
      const keyBytes = new Uint8Array(await this.retry(() => this.fetchBinary(uri)));
      key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
      this._keyCache.set(uri, key);
    }
    const ivBuf = iv ?? this.seqToIV(seg.sequence);
    return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBuf }, key, data);
  }

  private seqToIV(seq: number): Uint8Array {
    const iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, seq >>> 0, false);
    return iv;
  }

  private async pool(count: number, worker: (i: number) => Promise<void>) {
    let cursor = 0;
    const run = async () => {
      while (cursor < count && !this._aborted) {
        const i = cursor++;
        await worker(i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, count) }, run));
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < this.retries; i++) {
      if (this._aborted) throw new Error('已中止');
      try {
        return await fn();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('已中止');
        lastErr = e;
        if (i < this.retries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private async fetchText(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { credentials: 'include', signal: this._abortController?.signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error('已中止');
      throw new Error(`网络请求失败，请检查连接（${this.shortUrl(url)}）`);
    }
    if (!res.ok) throw new Error(this.classifyHttpError(res.status, url));
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
        signal: this._abortController?.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error('已中止');
      throw new Error(`网络请求失败，请检查连接（${this.shortUrl(url)}）`);
    }
    if (!res.ok && res.status !== 206) throw new Error(this.classifyHttpError(res.status, url));
    const buf = await res.arrayBuffer();
    this._downloadedBytes += buf.byteLength;
    this._recordSpeedSample();
    return buf;
  }

  private classifyHttpError(status: number, url: string): string {
    const u = this.shortUrl(url);
    if (status === 403)
      return `403 拒绝访问 — 该流可能需要登录或 Referer，请刷新视频页面后重新触发下载（${u}）`;
    if (status === 404) return `404 未找到 — 链接已失效或分片已过期（${u}）`;
    if (status === 429) return `429 请求过于频繁 — 尝试降低并发数后重试（${u}）`;
    if (status >= 500) return `${status} 服务器错误 — 稍后重试（${u}）`;
    return `HTTP ${status}（${u}）`;
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
    const now = Date.now();
    this._speedSamples.push({ t: now, cumBytes: this._downloadedBytes });
    const cutoff = now - 4_000;
    while (this._speedSamples.length > 1 && this._speedSamples[0].t < cutoff) {
      this._speedSamples.shift();
    }
  }

  private _calcSpeed(): number {
    if (this._speedSamples.length < 2) return 0;
    const first = this._speedSamples[0];
    const last = this._speedSamples[this._speedSamples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.1) return 0;
    return (last.cumBytes - first.cumBytes) / dt;
  }

  async saveBlob(blob: Blob, filename: string): Promise<void> {
    const blobUrl = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url: blobUrl, filename });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    } catch {
      const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }
  }
}
