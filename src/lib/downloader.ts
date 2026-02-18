import { M3U8Parser } from './m3u8-parser';
import type { ByteRange, InitSegment, Segment, StreamDef } from './types';

export interface DownloaderOptions {
  concurrency?: number;
  retries?: number;
  startIndex?: number; // inclusive, for range downloads
  endIndex?: number;   // inclusive, for range downloads
  onProgress?: (ratio: number, done: number, total: number, speedBps: number, downloadedBytes: number) => void;
  onStatus?: (msg: string, type?: 'info' | 'ok' | 'error') => void;
  onQualityChoice?: (streams: StreamDef[]) => Promise<StreamDef>;
}

export interface DownloadResult {
  bytes: number;
  segments: number;
  ext: string; // 'ts' or 'mp4'
}

const MERGE_BATCH = 100;

export class M3U8Downloader {
  private concurrency: number;
  private retries: number;
  private startIndex: number | undefined;
  private endIndex: number | undefined;
  private onProgress: NonNullable<DownloaderOptions['onProgress']>;
  private onStatus: NonNullable<DownloaderOptions['onStatus']>;
  private onQualityChoice: DownloaderOptions['onQualityChoice'];
  private _aborted = false;
  private _abortController: AbortController | null = null;
  private _keyCache = new Map<string, CryptoKey>();
  // Speed tracking
  private _downloadedBytes = 0;
  private _speedSamples: { t: number; cumBytes: number }[] = [];

  constructor(opts: DownloaderOptions = {}) {
    this.concurrency     = opts.concurrency ?? 6;
    this.retries         = opts.retries     ?? 3;
    this.startIndex      = opts.startIndex;
    this.endIndex        = opts.endIndex;
    this.onProgress      = opts.onProgress  ?? (() => {});
    this.onStatus        = opts.onStatus    ?? (() => {});
    this.onQualityChoice = opts.onQualityChoice;
  }

  abort() {
    this._aborted = true;
    this._abortController?.abort();
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

    return this.downloadSegments(
      segments,
      filename,
      playlist.initSegment,
      playlist.isFmp4,
    );
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

    // ── Concurrent download ────────────────────────────────────────
    const buffers = new Array<ArrayBuffer | null>(total).fill(null);
    let done = 0;

    await this.pool(total, async (i) => {
      if (this._aborted) throw new Error('已中止');
      buffers[i] = await this.downloadSegment(segments[i]);
      done++;
      this.onProgress(done / total, done, total, this._calcSpeed(), this._downloadedBytes);
    });

    if (this._aborted) throw new Error('已中止');

    // ── Batch merge ────────────────────────────────────────────────
    this.onStatus('正在合并分片…');
    const parts: Blob[] = [];
    if (initBuffer) { parts.push(new Blob([initBuffer])); initBuffer = null; }
    for (let i = 0; i < total; i += MERGE_BATCH) {
      const end = Math.min(i + MERGE_BATCH, total);
      parts.push(new Blob(buffers.slice(i, end) as ArrayBuffer[]));
      for (let j = i; j < end; j++) buffers[j] = null;
    }

    const ext = isFmp4 ? 'mp4' : 'ts';
    const mimeType = isFmp4 ? 'video/mp4' : 'video/mp2t';
    const blob = new Blob(parts, { type: mimeType });

    // ── Save ───────────────────────────────────────────────────────
    this.onStatus('准备保存文件…');
    await this.saveBlob(blob, `${filename}.${ext}`);

    const mb = (blob.size / 1024 / 1024).toFixed(2);
    this.onStatus(`下载完成！${total} 个分片，${mb} MB`, 'ok');
    return { bytes: blob.size, segments: total, ext };
  }

  // ── Internals ──────────────────────────────────────────────────

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
      try { return await fn(); } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new Error('已中止');
        lastErr = e;
        if (i < this.retries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { credentials: 'include', signal: this._abortController?.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.text();
  }

  private async fetchBinary(url: string, byteRange?: ByteRange): Promise<ArrayBuffer> {
    const headers: HeadersInit = byteRange
      ? { Range: `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}` }
      : {};
    const res = await fetch(url, { credentials: 'include', headers, signal: this._abortController?.signal });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} — ${url}`);
    const buf = await res.arrayBuffer();
    // Track bytes for speed calculation
    this._downloadedBytes += buf.byteLength;
    this._recordSpeedSample();
    return buf;
  }

  private _recordSpeedSample() {
    const now = Date.now();
    this._speedSamples.push({ t: now, cumBytes: this._downloadedBytes });
    // Keep only samples within the last 4 seconds
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
