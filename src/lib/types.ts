export interface StreamInfo {
  url: string;
  title: string;
  detectedAt: number;
}

export interface EncryptionInfo {
  method: string;
  uri: string | null;
  iv: Uint8Array | null;
}

export interface ByteRange {
  length: number;
  offset: number;
}

export interface InitSegment {
  url: string;
  byteRange?: ByteRange;
}

export interface Segment {
  url: string;
  duration: number;
  sequence: number;
  encryption: EncryptionInfo | null;
  byteRange?: ByteRange;
}

export interface StreamDef {
  bandwidth: number;
  resolution: string;
  codecs: string;
  name: string;
  frameRate: number;
  url: string;
}

export interface MasterPlaylist {
  type: 'master';
  streams: StreamDef[];
}

export interface MediaPlaylist {
  type: 'media';
  segments: Segment[];
  totalDuration: number;
  targetDuration: number;
  isEndList: boolean;
  isLive: boolean;
  initSegment?: InitSegment;
  isFmp4: boolean;
}

export type Playlist = MasterPlaylist | MediaPlaylist;

export type DownloadPhase =
  | 'idle'
  | 'prefetching'
  | 'downloading'
  | 'merging'
  | 'recording'   // live stream recording in progress
  | 'stopping'    // recording stop requested, waiting for final merge
  | 'done'
  | 'error'
  | 'aborted';

export interface LogEntry {
  time: string;
  msg: string;
  type: 'info' | 'ok' | 'error';
}

// ── History ──────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  url: string;
  filename: string;   // saved filename including extension
  segments: number;
  bytes: number;
  domain: string;
  quality?: string;
  doneAt: number;
  status: 'done' | 'error' | 'aborted';
  errorMsg?: string;
}

// ── Download Queue ────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  url: string;
  filename: string;
  status: 'pending' | 'downloading' | 'done' | 'error';
  progress: number;   // 0–1
  addedAt: number;
  errorMsg?: string;
}
