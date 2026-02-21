<script lang="ts">
  import { onMount } from 'svelte';
  import { M3U8Parser } from '../../lib/m3u8-parser';
  import { MpdParser } from '../../lib/mpd-parser';
  import { M3U8Downloader, PartialDownloadError } from '../../lib/downloader';
  import { LiveRecorder } from '../../lib/live-recorder';
  import { loadSettings, saveSettings } from '../../lib/settings';
  import type { Lang } from '../../lib/i18n.svelte';
  import { i18n } from '../../lib/i18n.svelte';
  import { ABORT_MSG } from '../../lib/downloader';
  import type { DownloaderMessages } from '../../lib/downloader';
  import type { LiveRecorderMessages } from '../../lib/live-recorder';
  import { addHistoryEntry } from '../../lib/history';
  import { MSG } from '../../lib/messages';
  import { guessFilename, formatSpeed } from '../../lib/utils';
  import { getCachedProgress, clearCachedSegments, cleanupStaleCaches } from '../../lib/segment-cache';
  import type { DownloadCheckpoint, DownloadPhase, LogEntry, MediaTrack, Segment, SegmentStatus, StreamDef } from '../../lib/types';
  import SegmentRangeSlider from './SegmentRangeSlider.svelte';
  import LogTerminal from './LogTerminal.svelte';
  import SegmentGrid from './SegmentGrid.svelte';
  import ProgressDisplay from './ProgressDisplay.svelte';
  import RecordingStatus from './RecordingStatus.svelte';
  import ActionButtons from './ActionButtons.svelte';

  // ── URL / queue params ──────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const m3u8Url = params.get('url') ?? '';
  const queueId = params.get('queueId') ?? '';
  const initName = params.get('filename') ?? '';

  // ── State ───────────────────────────────────────────────────────
  let phase = $state<DownloadPhase>('idle');
  let filename = $state(initName || guessFilename(m3u8Url));
  let concurrency = $state(6);
  let retries = $state(3);
  let streams = $state<StreamDef[]>([]);
  let selected = $state<StreamDef | null>(null);
  let progress = $state(0);
  let segDone = $state(0);
  let segTotal = $state(0);
  let speedBps = $state(0);
  let dlBytes = $state(0);
  let logs = $state<LogEntry[]>([]);
  let errorMsg = $state('');
  let convertToMp4 = $state(false);
  // VOD range
  let vodSegments = $state<Segment[]>([]);
  let rangeStart = $state(0);
  let rangeEnd = $state(0);
  let isLive = $state(false);
  // Live recording
  let recCount = $state(0);
  let recDurSec = $state(0);
  let recBytes = $state(0);
  let recElapsed = $state(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  // Segment-level status grid
  let segStatuses = $state<SegmentStatus[]>([]);
  // Subtitle & audio tracks
  let subtitleTracks = $state<MediaTrack[]>([]);
  let selectedSubtitles = $state<Set<string>>(new Set());
  let audioTracks = $state<MediaTrack[]>([]);
  let selectedAudio = $state<string | null>(null);
  // Checkpoint / resume
  let pendingCheckpoint = $state<DownloadCheckpoint | null>(null);

  // ── Derived ─────────────────────────────────────────────────────
  const pct = $derived(Math.round(progress * 100));
  const isRunning = $derived(
    ['prefetching', 'downloading', 'paused', 'merging', 'recording', 'stopping'].includes(phase),
  );
  const isPartial = $derived(phase === 'partial');
  const canStart = $derived(!isRunning && !!m3u8Url && (streams.length === 0 || selected !== null));
  const speedLabel = $derived(formatSpeed(speedBps));
  const etaLabel = $derived(calcEta(segTotal, segDone, dlBytes, speedBps));
  const failedCount = $derived(segStatuses.filter((s) => s === 'failed').length);
  const okCount = $derived(segStatuses.filter((s) => s === 'ok').length);

  // ── i18n message objects for downloader & recorder ──────────────
  const downloaderMessages = $derived<DownloaderMessages>({
    fetchingPlaylist: i18n.t('dlFetchingPlaylist'),
    noStreamsInMaster: i18n.t('dlNoStreamsInMaster'),
    fetchingStream: (label: string) => i18n.t('dlFetchingStream', label),
    noSegmentsInMedia: i18n.t('dlNoSegmentsInMedia'),
    fetchingInitSegment: i18n.t('dlFetchingInitSegment'),
    segmentInfo: (total: number, fmt: string, dur: string) => i18n.t('dlSegmentInfo', total, fmt, dur),
    restoredFromCache: (count: number) => i18n.t('dlRestoredFromCache', count),
    segmentFailed: (index: number) => i18n.t('dlSegmentFailed', index),
    someSegmentsFailed: (count: number) => i18n.t('dlSomeSegmentsFailed', count),
    noFailedSegments: i18n.t('dlNoFailedSegments'),
    retryingFailed: (count: number) => i18n.t('dlRetryingFailed', count),
    segmentRetryFailed: (index: number) => i18n.t('dlSegmentRetryFailed', index),
    stillFailed: (count: number) => i18n.t('dlStillFailed', count),
    retryComplete: i18n.t('dlRetryComplete'),
    merging: i18n.t('dlMerging'),
    noOkSegments: i18n.t('dlNoOkSegments'),
    savingPartial: (count: number) => i18n.t('dlSavingPartial', count),
    savedPartial: (count: number, mb: string) => i18n.t('dlSavedPartial', count, mb),
    convertingMp4: i18n.t('dlConvertingMp4'),
    mp4ConvertDone: i18n.t('dlMp4ConvertDone'),
    mp4ConvertFailed: (msg: string) => i18n.t('dlMp4ConvertFailed', msg),
    prepareSave: i18n.t('dlPrepareSave'),
    downloadComplete: (segs: number, mb: string) => i18n.t('dlDownloadComplete', segs, mb),
    networkError: (url: string) => i18n.t('dlNetworkError', url),
    http403: (url: string) => i18n.t('dlHttp403', url),
    http404: (url: string) => i18n.t('dlHttp404', url),
    http429: (url: string) => i18n.t('dlHttp429', url),
    httpServer: (status: number, url: string) => i18n.t('dlHttpServer', status, url),
    httpGeneric: (status: number, url: string) => i18n.t('dlHttpGeneric', status, url),
    aes128MissingKey: i18n.t('dlAes128MissingKey'),
    circuitOpen: (n: number) => i18n.t('dlCircuitOpen', n),
    audioTrackDownloading: i18n.t('dlAudioTrackDownloading'),
    audioTrackDone: i18n.t('dlAudioTrackDone'),
    audioTrackFailed: (msg: string) => i18n.t('dlAudioTrackFailed', msg),
  });

  const recorderMessages = $derived<LiveRecorderMessages>({
    startRecording: i18n.t('lrStartRecording'),
    playlistFailed: (status: number) => i18n.t('lrPlaylistFailed', status),
    fetchFailed: (msg: string) => i18n.t('lrFetchFailed', msg),
    streamEnded: i18n.t('lrStreamEnded'),
    segmentFailed: (err: string, url: string) => i18n.t('lrSegmentFailed', err, url),
    mergingRecording: i18n.t('lrMergingRecording'),
    recordingDone: (count: number, mb: string) => i18n.t('lrRecordingDone', count, mb),
    aes128MissingKey: i18n.t('lrAes128MissingKey'),
    keyFetchFailed: (status: number) => i18n.t('lrKeyFetchFailed', status),
    tooManyErrors: (n: number) => i18n.t('lrTooManyErrors', n),
  });

  let _settingsReady = $state(false);
  let downloader: M3U8Downloader | null = null;
  let recorder: LiveRecorder | null = null;
  let startedAt = 0;
  let savedExt = $state('ts');
  // Throttle speed/ETA display to 500 ms so rapid segment completions don't
  // trigger excessive Svelte re-renders.
  let _lastSpeedUpdate = 0;
  const SPEED_UPDATE_INTERVAL = 500;

  // ── Orphan cache cleanup on page close ──────────────────────────
  // If the user aborted and then closes the tab, clear the session cache so
  // it doesn't silently restore on the next open. Mid-download closures are
  // intentionally left intact so the user can resume later.
  $effect(() => {
    function onPageHide() {
      if (phase === 'aborted' && m3u8Url) {
        clearCachedSegments(m3u8Url).catch(() => {});
      }
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  });

  // ── Init: prefetch playlist ─────────────────────────────────────
  onMount(async () => {
    // Best-effort cleanup of stale IndexedDB caches (fire-and-forget)
    cleanupStaleCaches().catch(() => {});

    const s = await loadSettings();
    concurrency = s.concurrency;
    convertToMp4 = s.convertToMp4;
    retries = s.retries;
    i18n.lang = s.language;

    if (!m3u8Url) {
      addLog(i18n.t('appNoUrl'), 'error');
      return;
    }

    // Check for cached segments from a previous interrupted download
    if (m3u8Url) {
      try {
        const { count, total } = await getCachedProgress(m3u8Url);
        if (count > 0) {
          pendingCheckpoint = {
            url: m3u8Url,
            filename: initName || guessFilename(m3u8Url),
            cachedCount: count,
            cachedTotal: total,
            savedAt: Date.now(),
          };
        }
      } catch {
        // IndexedDB unavailable — ignore
      }
    }

    phase = 'prefetching';
    addLog(i18n.t('appPreParsing'));

    try {
      const res = await fetch(m3u8Url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const isMpd =
        m3u8Url.toLowerCase().includes('.mpd') ||
        (text.trimStart().startsWith('<?xml') && text.includes('<MPD'));
      const pl = isMpd ? MpdParser.parse(text, m3u8Url) : M3U8Parser.parse(text, m3u8Url);

      if (pl.type === 'master' && pl.streams.length > 0) {
        streams = pl.streams;
        // Apply preferred resolution from settings
        const preferred = s.preferredResolution;
        const match = preferred
          ? pl.streams.find((st) => qualityLabel(st) === preferred)
          : null;
        selected = match ?? pl.streams[0];

        // Collect subtitle and audio tracks
        subtitleTracks = pl.mediaTracks.filter((t) => t.type === 'SUBTITLES');
        audioTracks = pl.mediaTracks.filter((t) => t.type === 'AUDIO');

        const opts = pl.streams
          .map((s) => s.resolution || `${Math.round(s.bandwidth / 1000)}k`)
          .join(' / ');
        addLog(i18n.t('appMasterDetected', pl.streams.length, opts), 'ok');
      } else if (pl.type === 'media') {
        const dur = M3U8Parser.formatDuration(pl.totalDuration);
        isLive = pl.isLive;
        if (pl.isLive) {
          addLog(i18n.t('appLiveDetected', pl.targetDuration), 'ok');
        } else {
          vodSegments = pl.segments;
          rangeStart = 0;
          rangeEnd = pl.segments.length - 1;
          if (pl.subtitleTracks && pl.subtitleTracks.length > 0) {
            subtitleTracks = pl.subtitleTracks;
          }
          addLog(i18n.t('appSegmentsFound', pl.segments.length, dur), 'ok');
        }
      }
    } catch (e: unknown) {
      addLog(i18n.t('appPreParseFailed', (e as Error).message), 'error');
    }

    phase = 'idle';
    _settingsReady = true;
  });

  // Persist settings when the user changes concurrency or convertToMp4.
  // _settingsReady guards against a spurious write during onMount initialization.
  $effect(() => {
    if (!_settingsReady) return;
    saveSettings({ concurrency, convertToMp4 }).catch(() => {});
  });

  // ── Start download / recording ──────────────────────────────────
  async function start() {
    if (!canStart) return;
    startedAt = Date.now();
    progress = segDone = segTotal = speedBps = dlBytes = 0;
    errorMsg = '';
    savedExt = 'ts';
    segStatuses = [];
    downloader = null;

    if (isLive) {
      await startRecording();
    } else {
      await startDownload();
    }
  }

  async function clearCheckpoint() {
    if (!m3u8Url) return;
    await clearCachedSegments(m3u8Url).catch(() => {});
  }

  async function startDownload() {
    phase = 'downloading';

    downloader = new M3U8Downloader({
      concurrency,
      retries,
      convertToMp4: !isLive && convertToMp4,
      startIndex: vodSegments.length > 0 ? rangeStart : undefined,
      endIndex: vodSegments.length > 0 ? rangeEnd : undefined,
      audioTrackUrl: selectedAudio ?? undefined,
      // Enable IndexedDB-backed resume: segments are persisted as they complete
      cacheKey: m3u8Url || undefined,
      messages: downloaderMessages,
      onProgress(r, done, total, speed, bytes) {
        progress = r;
        segDone = done;
        segTotal = total;
        dlBytes = bytes;
        // Throttle speed/ETA display to avoid re-renders on every segment.
        const now = Date.now();
        if (now - _lastSpeedUpdate >= SPEED_UPDATE_INTERVAL) {
          speedBps = speed;
          _lastSpeedUpdate = now;
        }
        if (queueId)
          chrome.runtime
            .sendMessage({ type: MSG.QUEUE_PROGRESS, queueId, progress: r })
            .catch(() => {});
      },
      onStatus(msg, type = 'info') {
        addLog(msg, (type ?? 'info') as LogEntry['type']);
      },
      onPhaseChange(p) {
        phase = p;
      },
      onSegmentCount(total) {
        segStatuses = new Array(total).fill('pending');
      },
      onSegmentStatus(index, status) {
        segStatuses[index] = status;
      },
      async onQualityChoice() {
        return selected ?? streams[0];
      },
    });

    try {
      const result = await downloader.download(m3u8Url, filename || 'video');
      savedExt = result.ext;
      phase = 'done';
      progress = 1;
      pendingCheckpoint = null;
      await clearCheckpoint();
      await saveHistory('done', result.bytes, result.segments, result.ext);
      notifyComplete(filename || 'video', result.segments, result.bytes, result.ext);
      await downloadSubtitleTracks();
      if (queueId)
        chrome.runtime
          .sendMessage({ type: MSG.QUEUE_ITEM_DONE, queueId, status: 'done' })
          .catch(() => {});
      downloader = null;
    } catch (e: unknown) {
      if (e instanceof PartialDownloadError) {
        // Keep downloader alive so retry/savePartial work
        phase = 'partial';
        addLog(i18n.t('appPartialFailed', e.failedCount), 'error');
        if (queueId)
          chrome.runtime
            .sendMessage({
              type: MSG.QUEUE_ITEM_DONE,
              queueId,
              status: 'error',
              errorMsg: e.message,
            })
            .catch(() => {});
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === ABORT_MSG) {
        phase = 'aborted';
        addLog(i18n.t('appDownloadAborted'), 'error');
        await saveHistory('aborted');
        if (queueId)
          chrome.runtime
            .sendMessage({
              type: MSG.QUEUE_ITEM_DONE,
              queueId,
              status: 'error',
              errorMsg: ABORT_MSG,
            })
            .catch(() => {});
      } else {
        phase = 'error';
        errorMsg = msg;
        addLog(i18n.t('appDownloadFailed', msg), 'error');
        await saveHistory('error', 0, 0, 'ts', msg);
        if (queueId)
          chrome.runtime
            .sendMessage({ type: MSG.QUEUE_ITEM_DONE, queueId, status: 'error', errorMsg: msg })
            .catch(() => {});
      }
      downloader = null;
    }
  }

  async function doRetryFailed() {
    if (!downloader) return;
    phase = 'downloading';
    try {
      const result = await downloader.retryFailed();
      savedExt = result.ext;
      phase = 'done';
      progress = 1;
      await saveHistory('done', result.bytes, result.segments, result.ext);
      notifyComplete(filename || 'video', result.segments, result.bytes, result.ext);
      downloader = null;
    } catch (e: unknown) {
      if (e instanceof PartialDownloadError) {
        phase = 'partial';
        addLog(i18n.t('dlStillFailed', e.failedCount), 'error');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === ABORT_MSG) {
        phase = 'aborted';
        addLog(i18n.t('appRetryAborted'), 'error');
      } else {
        phase = 'error';
        errorMsg = msg;
        addLog(i18n.t('appRetryFailed', msg), 'error');
      }
      downloader = null;
    }
  }

  async function doSavePartial() {
    if (!downloader) return;
    try {
      await downloader.savePartial();
    } catch (e: unknown) {
      addLog(i18n.t('appSaveFailed', (e as Error).message), 'error');
    }
  }

  async function startRecording() {
    phase = 'recording';
    recCount = recDurSec = recBytes = recElapsed = 0;
    elapsedTimer = setInterval(() => recElapsed++, 1000);

    recorder = new LiveRecorder({
      concurrency,
      messages: recorderMessages,
      onSegmentDone(count, dur, bytes) {
        recCount = count;
        recDurSec = dur;
        recBytes = bytes;
      },
      onStatus(msg, type = 'info') {
        addLog(msg, type as LogEntry['type']);
      },
    });

    try {
      await recorder.record(m3u8Url);
    } catch {
      /* aborted */
    }

    // If stopped (not aborted externally), save
    if (phase === 'recording' || phase === 'stopping') {
      phase = 'stopping';
      try {
        const result = await recorder.saveAs(filename || 'recording');
        phase = 'done';
        await saveHistory('done', result.bytes, result.segments, 'ts');
        notifyComplete(filename || 'recording', result.segments, result.bytes, 'ts');
      } catch (e: unknown) {
        phase = 'error';
        errorMsg = (e as Error).message;
        addLog(i18n.t('appSaveFailed', errorMsg), 'error');
      }
    }

    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    recorder = null;
  }

  function abort() {
    downloader?.abort();
    if (recorder) {
      recorder.stop();
      phase = 'stopping';
    }
  }

  function doPause() {
    downloader?.pause();
  }

  function doResume() {
    downloader?.resume();
  }

  function reset() {
    phase = 'idle';
    progress = segDone = segTotal = speedBps = dlBytes = 0;
    recCount = recDurSec = recBytes = recElapsed = 0;
    errorMsg = '';
    segStatuses = [];
    downloader = null;
  }

  function toggleLang() {
    const next: Lang = i18n.lang === 'zh' ? 'en' : 'zh';
    i18n.lang = next;
    saveSettings({ language: next }).catch(() => {});
  }

  function selectQuality(s: StreamDef) {
    selected = s;
    // Remember quality preference
    saveSettings({ preferredResolution: qualityLabel(s) }).catch(() => {});
  }

  function dismissCheckpoint() {
    pendingCheckpoint = null;
    // User chose "Start Fresh" — remove stale segments so the next download
    // doesn't silently restore them from the old interrupted session.
    if (m3u8Url) clearCachedSegments(m3u8Url).catch(() => {});
  }

  // ── Subtitle download ───────────────────────────────────────────
  async function downloadSubtitleTracks(): Promise<void> {
    if (selectedSubtitles.size === 0) return;
    for (const track of subtitleTracks) {
      if (!selectedSubtitles.has(track.uri)) continue;
      addLog(i18n.t('appSubtitleDownloading', track.name), 'info');
      try {
        const res = await fetch(track.uri, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const pl = M3U8Parser.parse(text, track.uri);
        let blob: Blob;
        if (pl.type === 'media' && pl.segments.length > 0) {
          // Download VTT segments, then merge — strip duplicate WEBVTT headers
          const texts = await Promise.all(
            pl.segments.map(async (seg) => {
              try {
                const r = await fetch(seg.url, { credentials: 'include' });
                return r.ok ? r.text() : Promise.resolve('');
              } catch {
                return '';
              }
            }),
          );
          const merged = texts.reduce((acc, vtt, idx) => {
            if (!vtt) return acc;
            return acc + (idx === 0 ? vtt : '\n' + vtt.replace(/^WEBVTT[^\n]*\n*/i, ''));
          }, '');
          blob = new Blob([merged], { type: 'text/vtt' });
        } else {
          // Direct VTT file
          blob = new Blob([text], { type: 'text/vtt' });
        }
        const subFilename = `${filename || 'video'}_${track.language ?? track.name}.vtt`;
        const helper = new M3U8Downloader();
        await helper.saveBlob(blob, subFilename);
        addLog(i18n.t('appSubtitleDone', track.name), 'ok');
      } catch (e: unknown) {
        addLog(i18n.t('appSubtitleFailed', track.name, (e as Error).message), 'warn');
      }
    }
  }

  // ── History helper ──────────────────────────────────────────────
  async function saveHistory(
    status: 'done' | 'error' | 'aborted',
    bytes = 0,
    segments = 0,
    ext = 'ts',
    errMsg?: string,
  ) {
    try {
      await addHistoryEntry({
        url: m3u8Url,
        filename: `${filename || 'video'}.${ext}`,
        segments,
        bytes,
        domain: new URL(m3u8Url).hostname,
        quality: selected ? qualityLabel(selected) : undefined,
        doneAt: Date.now(),
        status,
        errorMsg: errMsg,
      });
    } catch {
      /* non-critical */
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function addLog(msg: string, type: LogEntry['type'] = 'info') {
    const now = new Date().toLocaleTimeString(undefined, { hour12: false });
    // Mutate in-place and reassign to trigger Svelte reactivity without
    // allocating a new array on every call (important during high-throughput
    // downloads where hundreds of log entries may arrive per second).
    if (logs.length >= 500) logs.splice(0, logs.length - 499);
    logs.push({ time: now, msg, type });
    logs = logs;
  }

  function notifyComplete(fname: string, segments: number, bytes: number, ext: string) {
    try {
      const mb = (bytes / 1024 / 1024).toFixed(1);
      const title = i18n.lang === 'zh' ? '下载完成' : 'Download Complete';
      const message = `${fname}.${ext}  ·  ${segments} 片  ·  ${mb} MB`;
      chrome.notifications.create(`dl_done_${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title,
        message,
      });
    } catch {
      // Notifications permission may not be granted in all environments
    }
  }

  function qualityLabel(s: StreamDef): string {
    return s.resolution || `${Math.round(s.bandwidth / 1000)}k`;
  }

  function calcEta(total: number, done: number, bytes: number, speed: number): string {
    if (speed <= 0 || done <= 0 || total <= 0 || done >= total) return '';
    const avgPerSeg = bytes / done;
    const remaining = (total - done) * avgPerSeg;
    const secs = Math.round(remaining / speed);
    if (secs < 60) return `~${secs}s`;
    if (secs < 3600) return `~${Math.floor(secs / 60)}m${(secs % 60).toString().padStart(2, '0')}s`;
    return `~${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
  }
</script>

<!-- ──────────────────────────────────────────── MARKUP ─ -->
<div class="page">
  <!-- Top bar -->
  <nav class="topbar">
    <div class="nav-logo">
      <svg viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="url(#nlg)" />
        <path
          d="M10 22V10l6 5 6-5v12"
          stroke="#fff"
          stroke-width="2.2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <defs>
          <linearGradient id="nlg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stop-color="#5b9df6" />
            <stop offset="100%" stop-color="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>
      <span>M3U8 <em>Downloader</em></span>
    </div>
    <div class="nav-status">
      <div class="nav-badge" class:visible={phase === 'downloading' || phase === 'paused' || phase === 'merging'}>
        <span class="dot"></span>{pct}%
      </div>
      {#if phase === 'recording'}
        <div class="nav-rec">
          <span class="rec-dot"></span>REC · {M3U8Parser.formatDuration(recElapsed)}
        </div>
      {/if}
    </div>
    <button class="lang-switch" onclick={toggleLang} title={i18n.lang === 'zh' ? 'Switch to English' : '切换为中文'}>
      {i18n.lang === 'zh' ? '中' : 'En'}
    </button>
  </nav>

  <!-- Main -->
  <main class="content">
    <!-- URL Card -->
    <section class="card url-card">
      <div class="card-label">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
        {i18n.t('streamUrl')}
        {#if isLive}<span class="live-chip">{i18n.t('liveLabel')}</span>{/if}
      </div>
      <div class="url-text">{m3u8Url || i18n.t('noUrl')}</div>
    </section>

    <!-- Settings -->
    <section class="card settings-card">
      <div class="card-label">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
          />
        </svg>
        {i18n.t('settingsLabel')}
      </div>

      <div class="settings-grid">
        <div class="field">
          <label for="fname">{i18n.t('filenameLabel')}</label>
          <div class="input-row">
            <input
              id="fname"
              class="text-input"
              bind:value={filename}
              disabled={isRunning}
              spellcheck="false"
            />
            <span class="ext">.{isLive ? 'ts' : savedExt || (convertToMp4 ? 'mp4' : 'ts')}</span>
          </div>
        </div>
        <div class="field">
          <label for="conc">{i18n.t('concurrencyLabel')}</label>
          <div class="slider-row">
            <input
              id="conc"
              type="range"
              min="1"
              max="16"
              bind:value={concurrency}
              disabled={isRunning}
              class="slider"
            />
            <span class="slider-val">{concurrency}</span>
          </div>
        </div>
        {#if !isLive}
          <div class="field">
            <span class="field-label" id="fmt-label">{i18n.t('formatLabel')}</span>
            <div
              class="format-toggle"
              class:disabled={isRunning}
              role="group"
              aria-labelledby="fmt-label"
            >
              <button
                class:active={!convertToMp4}
                onclick={() => !isRunning && (convertToMp4 = false)}
                >.ts <span class="fmt-hint">{i18n.t('formatTs')}</span></button
              >
              <button
                class:active={convertToMp4}
                onclick={() => !isRunning && (convertToMp4 = true)}
                >.mp4 <span class="fmt-hint">{i18n.t('formatMp4')}</span></button
              >
            </div>
          </div>
        {/if}
      </div>

      <!-- Quality selector -->
      {#if streams.length > 0}
        <div class="quality-section">
          <span class="quality-label" id="quality-label">{i18n.t('qualityLabel')}</span>
          <div class="quality-list" role="group" aria-labelledby="quality-label">
            {#each streams as s, i (s.url)}
              <button
                class="quality-chip"
                class:active={selected === s}
                onclick={() => selectQuality(s)}
                disabled={isRunning}
              >
                {qualityLabel(s)}
                {#if i === 0}<span class="best-tag">{i18n.t('bestTag')}</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Subtitle tracks -->
      {#if subtitleTracks.length > 0}
        <div class="track-section">
          <span class="track-label">{i18n.t('subtitleTracksLabel')}</span>
          <div class="track-list">
            {#each subtitleTracks as track (track.uri)}
              <label class="track-chip">
                <input
                  type="checkbox"
                  checked={selectedSubtitles.has(track.uri)}
                  onchange={(e) => {
                    const next = new Set(selectedSubtitles);
                    if ((e.target as HTMLInputElement).checked) next.add(track.uri);
                    else next.delete(track.uri);
                    selectedSubtitles = next;
                  }}
                  disabled={isRunning}
                />
                {track.name}{track.language ? ` (${track.language})` : ''}
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Audio tracks -->
      {#if audioTracks.length > 0}
        <div class="track-section">
          <span class="track-label">{i18n.t('audioTracksLabel')}</span>
          <div class="track-list">
            <label class="track-chip">
              <input
                type="radio"
                name="audio-track"
                value=""
                checked={selectedAudio === null}
                onchange={() => (selectedAudio = null)}
                disabled={isRunning}
              />
              {i18n.t('defaultAudio')}
            </label>
            {#each audioTracks as track (track.uri)}
              <label class="track-chip">
                <input
                  type="radio"
                  name="audio-track"
                  value={track.uri}
                  checked={selectedAudio === track.uri}
                  onchange={() => (selectedAudio = track.uri)}
                  disabled={isRunning}
                />
                {track.name}{track.language ? ` (${track.language})` : ''}
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Segment range selector (VOD only) -->
      {#if vodSegments.length > 1 && !isLive}
        <div class="range-section">
          <SegmentRangeSlider
            segments={vodSegments}
            bind:startIndex={rangeStart}
            bind:endIndex={rangeEnd}
            disabled={isRunning}
          />
        </div>
      {/if}
    </section>

    <!-- Checkpoint / resume prompt -->
    {#if pendingCheckpoint && phase === 'idle'}
      <section class="card checkpoint-card">
        <div class="checkpoint-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <span>{i18n.t('resumePrompt')} {i18n.t('resumeDone', pendingCheckpoint.cachedCount, pendingCheckpoint.cachedTotal)}</span>
        </div>
        <div class="checkpoint-actions">
          <button class="btn-resume" onclick={start}>{i18n.t('continueDownload')}</button>
          <button class="btn-discard" onclick={dismissCheckpoint}>{i18n.t('freshDownload')}</button>
        </div>
      </section>
    {/if}

    <!-- Action buttons -->
    <ActionButtons
      {phase}
      {isRunning}
      {isPartial}
      {isLive}
      {canStart}
      {segDone}
      {okCount}
      {failedCount}
      onstart={start}
      onabort={abort}
      onpause={doPause}
      onresume={doResume}
      onretryfailed={doRetryFailed}
      onsavepartial={doSavePartial}
      onreset={reset}
    />

    <!-- Recording status (live) -->
    {#if phase === 'recording' || phase === 'stopping'}
      <RecordingStatus {recCount} {recDurSec} {recBytes} />
    {/if}

    <!-- Progress (VOD) -->
    {#if phase !== 'idle' && phase !== 'prefetching' && phase !== 'recording' && phase !== 'stopping'}
      <ProgressDisplay {phase} {pct} {segDone} {segTotal} {speedLabel} {etaLabel} {isRunning} />
    {/if}

    <!-- Segment Status Grid -->
    {#if !isLive}
      <SegmentGrid {segStatuses} {failedCount} {okCount} />
    {/if}

    <!-- Log Terminal -->
    <LogTerminal {logs} />
  </main>
</div>

<!-- ──────────────────────────────────────────── STYLES ─ -->
<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }

  /* ── Top bar ── */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    height: 54px;
    background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border);
    box-shadow: 0 1px 0 var(--border), 0 2px 12px rgba(0, 0, 0, 0.04);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .nav-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
  }
  .nav-logo svg {
    width: 28px;
    height: 28px;
  }
  .nav-logo em {
    font-style: normal;
    background: var(--accent-grad);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .nav-status {
    display: flex;
    align-items: center;
  }

  .lang-switch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 28px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
    transition: all var(--transition);
  }
  .lang-switch:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-glow);
  }

  .nav-badge {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 14px;
    background: var(--accent-light);
    border: 1px solid #bfdbfe;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    opacity: 0;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.07);
    transition: opacity var(--transition);
  }
  .nav-badge.visible {
    opacity: 1;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .nav-rec {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    background: #f871711a;
    border: 1px solid #f8717140;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    color: var(--error);
  }
  .rec-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--error);
    animation: pulse 1s ease-in-out infinite;
  }

  /* ── Live chip ── */
  .live-chip {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f871711a;
    color: var(--error);
    border: 1px solid #f8717140;
  }

  /* ── Content ── */
  .content {
    flex: 1;
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    padding: 28px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    animation: fadeSlideIn 0.3s ease both;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  }
  .url-card {
    border-left: 3px solid var(--accent);
    background: linear-gradient(135deg, var(--surface) 0%, var(--accent-light) 100%);
  }
  .card-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-2);
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .card-label svg {
    width: 14px;
    height: 14px;
    color: var(--accent);
  }

  .url-text {
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 12px;
    color: var(--accent);
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid #bfdbfe;
    border-radius: var(--radius);
    padding: 10px 14px;
    word-break: break-all;
    line-height: 1.6;
    max-height: 72px;
    overflow-y: auto;
    box-shadow: inset 0 1px 3px rgba(37, 99, 235, 0.05);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 480px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .field label,
  .field .field-label {
    font-size: 11px;
    color: var(--text-2);
    font-weight: 500;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 12px;
    transition:
      border-color var(--transition),
      box-shadow var(--transition);
  }
  .input-row:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .text-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 13px;
    padding: 9px 0;
    outline: none;
  }
  .text-input:disabled {
    opacity: 0.5;
  }
  .ext {
    font-size: 12px;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider {
    flex: 1;
    -webkit-appearance: none;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    outline: none;
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent-grad);
    cursor: pointer;
    box-shadow: 0 0 6px #5b9df650;
  }
  .slider:disabled {
    opacity: 0.4;
  }
  .slider-val {
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
    min-width: 20px;
    text-align: center;
  }

  .quality-section {
    margin-top: 16px;
  }
  .quality-label {
    display: block;
    font-size: 11px;
    color: var(--text-2);
    font-weight: 500;
    margin-bottom: 9px;
  }
  .quality-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .quality-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 20px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
    transition: all var(--transition);
  }
  .quality-chip:not(:disabled):hover {
    border-color: var(--border-hi);
    color: var(--text);
  }
  .quality-chip.active {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
    font-weight: 600;
  }
  .quality-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .best-tag {
    font-size: 9px;
    font-weight: 700;
    color: var(--accent);
    background: rgba(37, 99, 235, 0.1);
    border: 1px solid rgba(37, 99, 235, 0.2);
    padding: 1px 5px;
    border-radius: 4px;
  }

  .range-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  /* ── Format toggle ── */
  .format-toggle {
    display: flex;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .format-toggle button {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    background: transparent;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .format-toggle button.active {
    background: var(--accent-light);
    color: var(--accent);
    border-right: 1px solid #bfdbfe;
    border-left: 1px solid #bfdbfe;
    font-weight: 700;
  }
  .format-toggle button:not(.active):hover {
    color: var(--text-2);
    background: var(--surface-3);
  }
  .format-toggle.disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .fmt-hint {
    font-size: 10px;
    color: var(--text-3);
    font-weight: 400;
  }

  /* ── Track selector (subtitles / audio) ── */
  .track-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .track-label {
    display: block;
    font-size: 11px;
    color: var(--text-2);
    font-weight: 500;
    margin-bottom: 9px;
  }
  .track-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .track-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    transition: all var(--transition);
  }
  .track-chip:hover {
    border-color: var(--border-hi);
    color: var(--text);
  }
  .track-chip input {
    accent-color: var(--accent);
  }

  /* ── Checkpoint card ── */
  .checkpoint-card {
    background: #5b9df610;
    border-color: var(--accent);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .checkpoint-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text);
  }
  .checkpoint-info svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: var(--accent);
  }
  .checkpoint-actions {
    display: flex;
    gap: 8px;
  }
  .btn-resume {
    padding: 6px 16px;
    border-radius: var(--radius);
    background: var(--accent-grad);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }
  .btn-discard {
    padding: 6px 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 12px;
  }
  .btn-discard:hover {
    border-color: var(--border-hi);
    color: var(--text-2);
  }
</style>
