import type {
  ByteRange,
  EncryptionInfo,
  InitSegment,
  MasterPlaylist,
  MediaPlaylist,
  MediaTrack,
  Playlist,
  Segment,
  StreamDef,
} from './types';

export class M3U8Parser {
  /** Hard cap on parsed segments to prevent OOM from pathological playlists. */
  private static readonly MAX_SEGMENTS = 50_000;

  static parse(text: string, baseUrl: string, subtitleTracks?: MediaTrack[]): Playlist {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines[0]?.startsWith('#EXTM3U')) {
      throw new Error('不是合法的 M3U8 文件（缺少 #EXTM3U 头）');
    }
    if (text.includes('#EXT-X-STREAM-INF')) {
      return this.parseMaster(lines, baseUrl);
    }
    const media = this.parseMedia(lines, baseUrl);
    if (subtitleTracks) media.subtitleTracks = subtitleTracks;
    return media;
  }

  private static parseMaster(lines: string[], baseUrl: string): MasterPlaylist {
    const streams: StreamDef[] = [];
    const mediaTracks: MediaTrack[] = [];
    let pending: Partial<StreamDef> | null = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-MEDIA:')) {
        const a = this.parseAttrs(line.slice('#EXT-X-MEDIA:'.length));
        const type = a['TYPE'];
        const uri = a['URI'];
        if ((type === 'SUBTITLES' || type === 'AUDIO') && uri) {
          mediaTracks.push({
            type: type as 'SUBTITLES' | 'AUDIO',
            name: a['NAME'] ?? '',
            language: a['LANGUAGE'],
            uri: this.resolve(uri, baseUrl),
          });
        }
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const a = this.parseAttrs(line.slice('#EXT-X-STREAM-INF:'.length));
        pending = {
          bandwidth: parseInt(a['BANDWIDTH'] ?? '0') || 0,
          resolution: a['RESOLUTION'] ?? '',
          codecs: a['CODECS'] ?? '',
          name: a['NAME'] ?? '',
          frameRate: parseFloat(a['FRAME-RATE'] ?? '0') || 0,
        };
      } else if (pending && !line.startsWith('#')) {
        streams.push({ ...pending, url: this.resolve(line, baseUrl) } as StreamDef);
        pending = null;
      }
    }

    streams.sort((a, b) => b.bandwidth - a.bandwidth);
    return { type: 'master', streams, mediaTracks };
  }

  private static parseMedia(lines: string[], baseUrl: string): MediaPlaylist {
    const segments: Segment[] = [];
    let segDuration = 0;
    let totalDuration = 0;
    let encryption: EncryptionInfo | null = null;
    let mediaSequence = 0;
    let targetDuration = 0;
    let isEndList = false;
    let initSegment: InitSegment | undefined;
    let isFmp4 = false;
    let pendingByteRange: { length: number; rawOffset: string | undefined } | null = null;
    // Track last byte-range end per URI for relative offsets
    const byteRangeEndByUri = new Map<string, number>();

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        segDuration = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      } else if (line.startsWith('#EXT-X-KEY:')) {
        encryption = this.parseKey(line, baseUrl);
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.split(':')[1] ?? '0') || 0;
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseInt(line.split(':')[1] ?? '0') || 0;
      } else if (line === '#EXT-X-ENDLIST') {
        isEndList = true;
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const a = this.parseAttrs(line.slice('#EXT-X-MAP:'.length));
        const rawUri = a['URI']?.replace(/^"|"$/g, '') ?? '';
        const brStr = a['BYTERANGE']?.replace(/^"|"$/g, '');
        let byteRange: ByteRange | undefined;
        if (brStr) {
          const [lenStr, offStr] = brStr.split('@');
          byteRange = { length: parseInt(lenStr), offset: parseInt(offStr ?? '0') };
        }
        initSegment = { url: this.resolve(rawUri, baseUrl), byteRange };
        isFmp4 = true;
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const val = line.slice('#EXT-X-BYTERANGE:'.length);
        const [lenStr, offStr] = val.split('@');
        pendingByteRange = { length: parseInt(lenStr), rawOffset: offStr };
      } else if (!line.startsWith('#') && segDuration > 0) {
        if (segments.length >= M3U8Parser.MAX_SEGMENTS) {
          throw new Error(`播放列表超出最大分片限制（${M3U8Parser.MAX_SEGMENTS}）`);
        }
        const url = this.resolve(line, baseUrl);
        let byteRange: ByteRange | undefined;
        if (pendingByteRange) {
          const offset =
            pendingByteRange.rawOffset !== undefined
              ? parseInt(pendingByteRange.rawOffset)
              : (byteRangeEndByUri.get(url) ?? 0);
          byteRange = { length: pendingByteRange.length, offset };
          byteRangeEndByUri.set(url, offset + pendingByteRange.length);
          pendingByteRange = null;
        }
        segments.push({
          url,
          duration: segDuration,
          sequence: mediaSequence + segments.length,
          encryption: encryption ? { ...encryption } : null,
          byteRange,
        });
        totalDuration += segDuration;
        segDuration = 0;
      }
    }

    return {
      type: 'media',
      segments,
      totalDuration,
      targetDuration,
      isEndList,
      isLive: !isEndList,
      initSegment,
      isFmp4,
      subtitleTracks: [],
    };
  }

  private static parseKey(line: string, baseUrl: string): EncryptionInfo | null {
    const a = this.parseAttrs(line.slice('#EXT-X-KEY:'.length));
    const method = a['METHOD'];
    if (!method || method === 'NONE') return null;
    const rawUri = a['URI']?.replace(/^"|"$/g, '') ?? null;
    return {
      method,
      uri: rawUri ? this.resolve(rawUri, baseUrl) : null,
      iv: a['IV'] ? this.parseIV(a['IV']) : null,
    };
  }

  private static parseIV(ivStr: string): Uint8Array {
    const raw = ivStr.replace(/^0[xX]/, '');
    if (raw.length > 32) {
      console.warn(`[M3U8Parser] IV 值异常（${raw.length} 字符，期望 ≤32），将取末尾 32 字符`);
    }
    // padStart handles short values; slice(-32) truncates oversized ones
    const hex = raw.padStart(32, '0').slice(-32);
    const iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return iv;
  }

  private static parseAttrs(str: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([A-Z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
      attrs[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
    }
    return attrs;
  }

  private static resolve(url: string, base: string): string {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  static formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
}
