/**
 * Remux MPEG-TS blob → fragmented MP4 using mux.js.
 * The output is a valid fMP4 (ISO BMFF) that can be played by VLC,
 * Chrome, Edge, Firefox, Android, and Windows Media Player.
 *
 * Supports: H.264 + AAC / MP3 streams (standard HLS).
 * Falls back gracefully — caller should catch and save as .ts if this throws.
 */

// mux.js has no bundled TypeScript types; declare only what we use.
interface MuxSegment {
  initSegment: Uint8Array;
  data: Uint8Array;
}
interface MuxTransmuxer {
  on(event: 'data', cb: (seg: MuxSegment) => void): void;
  on(event: 'done', cb: () => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
  push(data: Uint8Array): void;
  flush(): void;
  dispose?(): void;
}

// Shape of the mux.js module (ESM default export or CJS top-level)
interface MuxModule {
  default?: { mp4?: { Transmuxer: new (opts?: object) => MuxTransmuxer } };
  mp4?: { Transmuxer: new (opts?: object) => MuxTransmuxer };
}

/** Files larger than this threshold are not remuxed to avoid OOM.
 *  At peak, mux.js keeps ~2-3x the source size in memory simultaneously
 *  (original ArrayBuffer + transmuxer output chunks). 500 MB is a safe cap
 *  for typical browser extension environments.
 *  Caller catches the thrown error and falls back to saving as .ts. */
const REMUX_SIZE_LIMIT = 500 * 1024 * 1024; // 500 MB

export async function remuxTsToMp4(tsBlob: Blob): Promise<Blob> {
  if (tsBlob.size > REMUX_SIZE_LIMIT) {
    throw new Error(
      `File too large for remux (${(tsBlob.size / 1024 / 1024).toFixed(0)} MB > 500 MB limit) — saving as .ts`,
    );
  }

  // Dynamic import keeps mux.js out of the main popup/background bundles
  const mux = (await import('mux.js')) as unknown as MuxModule;
  const Transmuxer = mux.default?.mp4?.Transmuxer ?? mux.mp4?.Transmuxer;

  if (!Transmuxer) throw new Error('mux.js Transmuxer not found');

  const tsData = new Uint8Array(await tsBlob.arrayBuffer());

  return new Promise<Blob>((resolve, reject) => {
    const transmuxer = new Transmuxer({ remux: true });
    let initSegment: Uint8Array | null = null;
    const chunks: Uint8Array[] = [];

    transmuxer.on('data', (seg) => {
      if (seg.initSegment?.byteLength > 0) {
        initSegment = new Uint8Array(seg.initSegment);
      }
      if (seg.data?.byteLength > 0) {
        chunks.push(new Uint8Array(seg.data));
      }
    });

    transmuxer.on('done', () => {
      transmuxer.dispose?.();
      const parts: Uint8Array[] = [];
      if (initSegment) parts.push(initSegment);
      parts.push(...chunks);
      if (parts.length === 0) {
        reject(new Error('remux output is empty'));
        return;
      }
      resolve(new Blob(parts, { type: 'video/mp4' }));
    });

    transmuxer.on('error', (err) => {
      transmuxer.dispose?.();
      reject(new Error(`remux error: ${err}`));
    });

    try {
      transmuxer.push(tsData);
      transmuxer.flush();
    } catch (e) {
      transmuxer.dispose?.();
      reject(e);
    }
  });
}
