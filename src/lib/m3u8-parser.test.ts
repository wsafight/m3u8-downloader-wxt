import { describe, expect, test } from 'bun:test';
import { M3U8Parser } from './m3u8-parser';

const BASE = 'https://cdn.example.com/hls/';

/** Wrap body in a minimal valid M3U8 envelope. */
function media(body: string) {
  return `#EXTM3U\n${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('M3U8Parser.parse() — validation', () => {
  test('throws when #EXTM3U header is missing', () => {
    expect(() => M3U8Parser.parse('#EXT-X-TARGETDURATION:6\n', BASE)).toThrow(
      '不是合法的 M3U8 文件',
    );
  });

  test('throws on empty input', () => {
    expect(() => M3U8Parser.parse('', BASE)).toThrow();
  });

  test('returns MasterPlaylist when #EXT-X-STREAM-INF is present', () => {
    const pl = M3U8Parser.parse(media('#EXT-X-STREAM-INF:BANDWIDTH=1000000\nindex.m3u8\n'), BASE);
    expect(pl.type).toBe('master');
  });

  test('returns MediaPlaylist otherwise', () => {
    const pl = M3U8Parser.parse(media('#EXTINF:5,\nseg.ts\n#EXT-X-ENDLIST\n'), BASE);
    expect(pl.type).toBe('media');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Master Playlist', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.4d001f,mp4a.40.2",FRAME-RATE=30
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p/index.m3u8
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'master' }
  >;

  test('returns all stream variants', () => {
    expect(pl.streams).toHaveLength(3);
  });

  test('sorts streams by bandwidth descending', () => {
    expect(pl.streams.map((s) => s.bandwidth)).toEqual([5000000, 2000000, 500000]);
  });

  test('parses RESOLUTION', () => {
    expect(pl.streams[0].resolution).toBe('1920x1080');
    expect(pl.streams[2].resolution).toBe('640x360');
  });

  test('parses CODECS and strips surrounding quotes', () => {
    expect(pl.streams[0].codecs).toBe('avc1.640028,mp4a.40.2');
  });

  test('parses FRAME-RATE', () => {
    expect(pl.streams[0].frameRate).toBe(30);
    expect(pl.streams[2].frameRate).toBe(0); // absent → 0
  });

  test('resolves relative stream URLs against base', () => {
    expect(pl.streams[0].url).toBe(`${BASE}1080p/index.m3u8`);
  });

  test('keeps absolute stream URLs unchanged', () => {
    const ABS = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000
https://other.cdn.com/hls/index.m3u8
`;
    const p = M3U8Parser.parse(ABS, BASE) as Extract<
      ReturnType<typeof M3U8Parser.parse>,
      { type: 'master' }
    >;
    expect(p.streams[0].url).toBe('https://other.cdn.com/hls/index.m3u8');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Media Playlist — basics', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:5.999,
seg0.ts
#EXTINF:5.999,
seg1.ts
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('type is media', () => expect(pl.type).toBe('media'));
  test('segment count', () => expect(pl.segments).toHaveLength(2));
  test('totalDuration', () => expect(pl.totalDuration).toBeCloseTo(11.998));
  test('targetDuration', () => expect(pl.targetDuration).toBe(6));
  test('isEndList', () => expect(pl.isEndList).toBe(true));
  test('isLive', () => expect(pl.isLive).toBe(false));
  test('isFmp4 defaults to false', () => expect(pl.isFmp4).toBe(false));
  test('initSegment absent', () => expect(pl.initSegment).toBeUndefined());
  test('segments have no encryption', () => expect(pl.segments[0].encryption).toBeNull());

  test('resolves segment URLs against base', () => {
    expect(pl.segments[0].url).toBe(`${BASE}seg0.ts`);
    expect(pl.segments[1].url).toBe(`${BASE}seg1.ts`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Media Playlist — sequence numbers', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:5,
seg.ts
#EXTINF:5,
seg.ts
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('first segment sequence equals EXT-X-MEDIA-SEQUENCE', () => {
    expect(pl.segments[0].sequence).toBe(100);
  });

  test('sequence increments by 1 per segment', () => {
    expect(pl.segments[1].sequence).toBe(101);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Media Playlist — live stream (no EXT-X-ENDLIST)', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:5.999,
seg500.ts
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('isEndList is false', () => expect(pl.isEndList).toBe(false));
  test('isLive is true', () => expect(pl.isLive).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AES-128 encryption', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://key.example.com/key",IV=0x1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d
#EXTINF:5,
seg0.ts
#EXTINF:5,
seg1.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:5,
seg2.ts
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('method is AES-128', () => {
    expect(pl.segments[0].encryption?.method).toBe('AES-128');
  });

  test('URI is preserved as-is (absolute)', () => {
    expect(pl.segments[0].encryption?.uri).toBe('https://key.example.com/key');
  });

  test('IV first byte', () => expect(pl.segments[0].encryption?.iv?.[0]).toBe(0x1a));
  test('IV second byte', () => expect(pl.segments[0].encryption?.iv?.[1]).toBe(0x2b));
  test('IV last byte', () => expect(pl.segments[0].encryption?.iv?.[15]).toBe(0x4d));

  test('encryption carries over to subsequent segments', () => {
    expect(pl.segments[1].encryption?.method).toBe('AES-128');
  });

  test('each segment gets an independent copy of EncryptionInfo', () => {
    expect(pl.segments[0].encryption).not.toBe(pl.segments[1].encryption);
  });

  test('METHOD=NONE clears encryption for following segments', () => {
    expect(pl.segments[2].encryption).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('IV parsing', () => {
  function parseIV(ivHex: string) {
    const pl = M3U8Parser.parse(
      media(`#EXT-X-KEY:METHOD=AES-128,URI="k",IV=${ivHex}\n#EXTINF:5,\nseg.ts\n#EXT-X-ENDLIST\n`),
      BASE,
    ) as Extract<ReturnType<typeof M3U8Parser.parse>, { type: 'media' }>;
    return pl.segments[0].encryption!.iv!;
  }

  test('0x-prefixed 32-digit hex → correct bytes', () => {
    const iv = parseIV('0x1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d');
    expect(iv).toHaveLength(16);
    expect(iv[0]).toBe(0x1a);
    expect(iv[15]).toBe(0x4d);
  });

  test('short hex is left-padded to 16 bytes', () => {
    const iv = parseIV('0x1');
    expect(iv[15]).toBe(0x01);
    expect(iv[14]).toBe(0x00);
    expect(iv[0]).toBe(0x00);
  });

  test('all-zeros IV', () => {
    const iv = parseIV('0x00000000000000000000000000000000');
    expect(iv.every((b) => b === 0)).toBe(true);
  });

  test('max-value IV (all 0xFF)', () => {
    const iv = parseIV('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
    expect(iv.every((b) => b === 0xff)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('fMP4 — EXT-X-MAP without BYTERANGE', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXTINF:5,
seg0.mp4
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('isFmp4 is true', () => expect(pl.isFmp4).toBe(true));
  test('initSegment URL is resolved', () => {
    expect(pl.initSegment?.url).toBe(`${BASE}init.mp4`);
  });
  test('initSegment byteRange is undefined', () => {
    expect(pl.initSegment?.byteRange).toBeUndefined();
  });
});

describe('fMP4 — EXT-X-MAP with BYTERANGE', () => {
  const FIXTURE = `#EXTM3U
#EXT-X-MAP:URI="video.mp4",BYTERANGE="843@0"
#EXTINF:5,
video.mp4
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('initSegment byteRange length', () => {
    expect(pl.initSegment?.byteRange?.length).toBe(843);
  });
  test('initSegment byteRange offset', () => {
    expect(pl.initSegment?.byteRange?.offset).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('EXT-X-BYTERANGE segments', () => {
  // Three consecutive segments in the same file.
  // seg0: explicit offset 200, length 100  → occupies [200, 300)
  // seg1: no offset → continues from 300, length 150 → occupies [300, 450)
  // seg2: no offset → continues from 450, length 80  → occupies [450, 530)
  const FIXTURE = `#EXTM3U
#EXTINF:5,
#EXT-X-BYTERANGE:100@200
video.ts
#EXTINF:5,
#EXT-X-BYTERANGE:150
video.ts
#EXTINF:5,
#EXT-X-BYTERANGE:80
video.ts
#EXT-X-ENDLIST
`;

  const pl = M3U8Parser.parse(FIXTURE, BASE) as Extract<
    ReturnType<typeof M3U8Parser.parse>,
    { type: 'media' }
  >;

  test('first segment: explicit offset', () => {
    expect(pl.segments[0].byteRange).toEqual({ length: 100, offset: 200 });
  });

  test('second segment: auto-offset = end of previous (200 + 100 = 300)', () => {
    expect(pl.segments[1].byteRange).toEqual({ length: 150, offset: 300 });
  });

  test('third segment: auto-offset = end of previous (300 + 150 = 450)', () => {
    expect(pl.segments[2].byteRange).toEqual({ length: 80, offset: 450 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('M3U8Parser.formatDuration()', () => {
  const fmt = (s: number) => M3U8Parser.formatDuration(s);

  test('0 seconds → 0:00', () => expect(fmt(0)).toBe('0:00'));
  test('9 seconds → 0:09', () => expect(fmt(9)).toBe('0:09'));
  test('59 seconds → 0:59', () => expect(fmt(59)).toBe('0:59'));
  test('60 seconds → 1:00', () => expect(fmt(60)).toBe('1:00'));
  test('90 seconds → 1:30', () => expect(fmt(90)).toBe('1:30'));
  test('3599 seconds → 59:59', () => expect(fmt(3599)).toBe('59:59'));
  test('3600 seconds → 1:00:00', () => expect(fmt(3600)).toBe('1:00:00'));
  test('3661 seconds → 1:01:01', () => expect(fmt(3661)).toBe('1:01:01'));
  test('7384 seconds → 2:03:04', () => expect(fmt(7384)).toBe('2:03:04'));
  test('fractional seconds are floored', () => expect(fmt(5.9)).toBe('0:05'));
});
