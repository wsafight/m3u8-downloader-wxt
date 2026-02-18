<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { M3U8Parser } from '../../lib/m3u8-parser';
  import { M3U8Downloader } from '../../lib/downloader';
  import { LiveRecorder } from '../../lib/live-recorder';
  import { loadSettings, saveSettings } from '../../lib/settings';
  import { addHistoryEntry } from '../../lib/history';
  import type { DownloadPhase, LogEntry, MediaPlaylist, Segment, StreamDef } from '../../lib/types';
  import SegmentRangeSlider from './SegmentRangeSlider.svelte';

  // ── URL / queue params ──────────────────────────────────────────
  const params   = new URLSearchParams(location.search);
  const m3u8Url  = params.get('url') ?? '';
  const queueId  = params.get('queueId') ?? '';
  const initName = params.get('filename') ?? '';

  // ── State ───────────────────────────────────────────────────────
  let phase       = $state<DownloadPhase>('idle');
  let filename    = $state(initName || guessFilename(m3u8Url));
  let concurrency = $state(6);
  let streams     = $state<StreamDef[]>([]);
  let selected    = $state<StreamDef | null>(null);
  let progress    = $state(0);
  let segDone     = $state(0);
  let segTotal    = $state(0);
  let speedBps    = $state(0);
  let dlBytes     = $state(0);
  let logs        = $state<LogEntry[]>([]);
  let errorMsg    = $state('');
  // VOD range
  let vodSegments = $state<Segment[]>([]);
  let rangeStart  = $state(0);
  let rangeEnd    = $state(0);
  let isLive      = $state(false);
  // Live recording
  let recCount    = $state(0);
  let recDurSec   = $state(0);
  let recBytes    = $state(0);
  let recElapsed  = $state(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  let downloader: M3U8Downloader | null = null;
  let recorder: LiveRecorder | null = null;
  let logEl: HTMLElement;
  let startedAt = 0;
  let savedExt = 'ts';

  // ── Derived ─────────────────────────────────────────────────────
  const pct       = $derived(Math.round(progress * 100));
  const isRunning = $derived(['prefetching','downloading','merging','recording','stopping'].includes(phase));
  const canStart  = $derived(!isRunning && !!m3u8Url && (streams.length === 0 || selected !== null));
  const speedLabel = $derived(formatSpeed(speedBps));
  const etaLabel   = $derived(calcEta(segTotal, segDone, dlBytes, speedBps));

  // ── Init: prefetch playlist ─────────────────────────────────────
  onMount(async () => {
    const s = await loadSettings();
    concurrency = s.concurrency;

    if (!m3u8Url) { addLog('没有 M3U8 地址', 'error'); return; }

    phase = 'prefetching';
    addLog('正在预解析播放列表…');

    try {
      const res = await fetch(m3u8Url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const pl = M3U8Parser.parse(text, m3u8Url);

      if (pl.type === 'master' && pl.streams.length > 0) {
        streams = pl.streams;
        selected = pl.streams[0];
        const opts = pl.streams.map(s => s.resolution || `${Math.round(s.bandwidth / 1000)}k`).join(' / ');
        addLog(`检测到 Master Playlist，${pl.streams.length} 个清晰度：${opts}`, 'ok');
      } else if (pl.type === 'media') {
        const dur = M3U8Parser.formatDuration(pl.totalDuration);
        isLive = pl.isLive;
        if (pl.isLive) {
          addLog(`直播流，目标分片时长 ${pl.targetDuration}s`, 'ok');
        } else {
          vodSegments = pl.segments;
          rangeStart = 0;
          rangeEnd = pl.segments.length - 1;
          addLog(`共 ${pl.segments.length} 个分片，时长约 ${dur}`, 'ok');
        }
      }
    } catch (e: unknown) {
      addLog(`预解析失败：${(e as Error).message}`, 'error');
    }

    phase = 'idle';
  });

  // Persist concurrency when it changes
  $effect(() => {
    saveSettings({ concurrency }).catch(() => {});
  });

  // ── Start download / recording ──────────────────────────────────
  async function start() {
    if (!canStart) return;
    startedAt = Date.now();
    progress = segDone = segTotal = speedBps = dlBytes = 0;
    errorMsg = '';
    savedExt = 'ts';

    if (isLive) {
      await startRecording();
    } else {
      await startDownload();
    }
  }

  async function startDownload() {
    phase = 'downloading';

    downloader = new M3U8Downloader({
      concurrency,
      retries: 3,
      startIndex: vodSegments.length > 0 ? rangeStart : undefined,
      endIndex:   vodSegments.length > 0 ? rangeEnd   : undefined,
      onProgress(r, done, total, speed, bytes) {
        progress = r; segDone = done; segTotal = total;
        speedBps = speed; dlBytes = bytes;
        if (queueId) chrome.runtime.sendMessage({ type: 'QUEUE_PROGRESS', queueId, progress: r }).catch(() => {});
      },
      onStatus(msg, type = 'info') {
        addLog(msg, type as LogEntry['type']);
        if (msg.includes('合并')) phase = 'merging';
      },
      async onQualityChoice() { return selected ?? streams[0]; },
    });

    try {
      const result = await downloader.download(m3u8Url, filename || 'video');
      savedExt = result.ext;
      phase = 'done';
      progress = 1;
      await saveHistory('done', result.bytes, result.segments, result.ext);
      if (queueId) chrome.runtime.sendMessage({ type: 'QUEUE_ITEM_DONE', queueId, status: 'done' }).catch(() => {});
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg === '已中止') {
        phase = 'aborted';
        addLog('下载已中止', 'error');
        await saveHistory('aborted');
        if (queueId) chrome.runtime.sendMessage({ type: 'QUEUE_ITEM_DONE', queueId, status: 'error', errorMsg: '已中止' }).catch(() => {});
      } else {
        phase = 'error';
        errorMsg = msg;
        addLog(`下载失败：${msg}`, 'error');
        await saveHistory('error', 0, 0, 'ts', msg);
        if (queueId) chrome.runtime.sendMessage({ type: 'QUEUE_ITEM_DONE', queueId, status: 'error', errorMsg: msg }).catch(() => {});
      }
    } finally {
      downloader = null;
    }
  }

  async function startRecording() {
    phase = 'recording';
    recCount = recDurSec = recBytes = recElapsed = 0;
    elapsedTimer = setInterval(() => recElapsed++, 1000);

    recorder = new LiveRecorder({
      concurrency,
      onSegmentDone(count, dur, bytes) {
        recCount = count; recDurSec = dur; recBytes = bytes;
      },
      onStatus(msg, type = 'info') {
        addLog(msg, type as LogEntry['type']);
      },
    });

    try {
      await recorder.record(m3u8Url);
    } catch { /* aborted */ }

    // If stopped (not aborted externally), save
    if (phase === 'recording' || phase === 'stopping') {
      phase = 'stopping';
      try {
        const result = await recorder.saveAs(filename || 'recording');
        phase = 'done';
        await saveHistory('done', result.bytes, result.segments, 'ts');
      } catch (e: unknown) {
        phase = 'error';
        errorMsg = (e as Error).message;
        addLog(`保存失败：${errorMsg}`, 'error');
      }
    }

    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    recorder = null;
  }

  function abort() {
    downloader?.abort();
    if (recorder) { recorder.stop(); phase = 'stopping'; }
  }

  function reset() {
    phase = 'idle';
    progress = segDone = segTotal = speedBps = dlBytes = 0;
    recCount = recDurSec = recBytes = recElapsed = 0;
    errorMsg = '';
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
    } catch { /* non-critical */ }
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function addLog(msg: string, type: LogEntry['type'] = 'info') {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const entry = { time: now, msg, type };
    logs = logs.length >= 500 ? [...logs.slice(-499), entry] : [...logs, entry];
    tick().then(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
  }

  function qualityLabel(s: StreamDef): string {
    return s.resolution || `${Math.round(s.bandwidth / 1000)}k`;
  }

  function guessFilename(url: string): string {
    try {
      const path = new URL(url).pathname;
      return path.split('/').filter(Boolean).slice(-2).join('_')
        .replace(/\.m3u8.*$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
        .slice(0, 60) || 'video';
    } catch { return 'video'; }
  }

  function formatSpeed(bps: number): string {
    if (bps <= 0) return '';
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
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

  function phaseLabel(p: DownloadPhase): string {
    switch (p) {
      case 'prefetching': return '解析中…';
      case 'downloading': return '下载中';
      case 'merging':     return '合并中…';
      case 'recording':   return '录制中';
      case 'stopping':    return '保存中…';
      case 'done':        return '完成！';
      case 'error':       return '失败';
      case 'aborted':     return '已中止';
      default:            return isLive ? '开始录制' : '开始下载';
    }
  }
</script>

<!-- ──────────────────────────────────────────── MARKUP ─ -->
<div class="page">

  <!-- Top bar -->
  <nav class="topbar">
    <div class="nav-logo">
      <svg viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="url(#nlg)"/>
        <path d="M10 22V10l6 5 6-5v12" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
        <defs>
          <linearGradient id="nlg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stop-color="#5b9df6"/>
            <stop offset="100%" stop-color="#22d3ee"/>
          </linearGradient>
        </defs>
      </svg>
      <span>M3U8 <em>Downloader</em></span>
    </div>
    <div class="nav-badge" class:visible={phase === 'downloading' || phase === 'merging'}>
      <span class="dot"></span>{pct}%
    </div>
    {#if phase === 'recording'}
      <div class="nav-rec"><span class="rec-dot"></span>REC · {M3U8Parser.formatDuration(recElapsed)}</div>
    {/if}
  </nav>

  <!-- Main -->
  <main class="content">

    <!-- URL Card -->
    <section class="card url-card">
      <div class="card-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
        M3U8 地址
        {#if isLive}<span class="live-chip">LIVE</span>{/if}
      </div>
      <div class="url-text">{m3u8Url || '（未提供地址）'}</div>
    </section>

    <!-- Settings -->
    <section class="card settings-card">
      <div class="card-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        设置
      </div>

      <div class="settings-grid">
        <div class="field">
          <label for="fname">文件名</label>
          <div class="input-row">
            <input id="fname" class="text-input" bind:value={filename} disabled={isRunning} spellcheck="false"/>
            <span class="ext">.{isLive ? 'ts' : (savedExt || 'ts')}</span>
          </div>
        </div>
        <div class="field">
          <label for="conc">并发数</label>
          <div class="slider-row">
            <input id="conc" type="range" min="1" max="16" bind:value={concurrency} disabled={isRunning} class="slider"/>
            <span class="slider-val">{concurrency}</span>
          </div>
        </div>
      </div>

      <!-- Quality selector -->
      {#if streams.length > 0}
        <div class="quality-section">
          <label class="quality-label">清晰度</label>
          <div class="quality-list">
            {#each streams as s, i (s.url)}
              <button class="quality-chip" class:active={selected === s} onclick={() => selected = s} disabled={isRunning}>
                {qualityLabel(s)}
                {#if i === 0}<span class="best-tag">BEST</span>{/if}
              </button>
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

    <!-- Download / Record Button -->
    <div class="action-row">
      {#if !isRunning}
        <button
          class="btn-main"
          class:done={phase === 'done'}
          class:error={phase === 'error'}
          class:live={isLive && phase === 'idle'}
          onclick={phase === 'done' || phase === 'error' || phase === 'aborted' ? reset : start}
          disabled={!canStart && phase === 'idle'}
        >
          {#if phase === 'done'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            下载完成
          {:else if phase === 'error'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            重试
          {:else if phase === 'aborted'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7"/><path d="M3 20h18"/></svg>
            重新下载
          {:else if isLive}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="7" opacity=".5"/></svg>
            开始录制
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7"/><path d="M3 20h18"/></svg>
            开始下载
          {/if}
        </button>
      {:else}
        <button class="btn-abort" onclick={abort}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
          {phase === 'recording' ? '停止录制' : '中止'}
        </button>
      {/if}
    </div>

    <!-- Recording status (live) -->
    {#if phase === 'recording' || phase === 'stopping'}
      <section class="rec-status">
        <span class="rec-indicator"><span class="rec-dot-anim"></span>录制中</span>
        <span>{recCount} 片 · {M3U8Parser.formatDuration(recDurSec)} · {(recBytes / 1024 / 1024).toFixed(1)} MB</span>
      </section>
    {/if}

    <!-- Progress (VOD) -->
    {#if phase !== 'idle' && phase !== 'prefetching' && phase !== 'recording' && phase !== 'stopping'}
      <section class="progress-section">
        <div class="progress-header">
          <span class="progress-pct" class:done={phase === 'done'}>{pct}%</span>
          <div class="progress-right">
            {#if segTotal > 0}
              <span class="progress-seg">{segDone} / {segTotal} 片</span>
            {:else}
              <span class="progress-seg">{phaseLabel(phase)}</span>
            {/if}
            {#if speedLabel}
              <span class="speed-eta">{speedLabel}{etaLabel ? ' · ' + etaLabel : ''}</span>
            {/if}
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" class:done={phase === 'done'} style="width: {pct}%"></div>
          {#if isRunning}<div class="progress-shimmer"></div>{/if}
        </div>
      </section>
    {/if}

    <!-- Log Terminal -->
    <section class="terminal">
      <div class="terminal-bar">
        <span class="dot-r"></span><span class="dot-y"></span><span class="dot-g"></span>
        <span class="terminal-title">日志</span>
      </div>
      <div class="terminal-body" bind:this={logEl}>
        {#if logs.length === 0}
          <span class="log-placeholder">等待操作…</span>
        {:else}
          {#each logs as log}
            <div class="log-line {log.type}">
              <span class="log-time">[{log.time}]</span>
              <span class="log-msg">{log.msg}</span>
            </div>
          {/each}
        {/if}
      </div>
    </section>

  </main>
</div>

<!-- ──────────────────────────────────────────── STYLES ─ -->
<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }

  /* ── Top bar ── */
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 28px; height: 54px;
    background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .nav-logo { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; color: var(--text); }
  .nav-logo svg { width: 28px; height: 28px; }
  .nav-logo em { font-style: normal; background: var(--accent-grad); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

  .nav-badge {
    display: flex; align-items: center; gap: 7px;
    padding: 4px 12px; background: var(--accent-glow);
    border: 1px solid var(--border-hi); border-radius: 20px;
    font-size: 13px; font-weight: 700; color: var(--accent);
    opacity: 0; transition: opacity var(--transition);
  }
  .nav-badge.visible { opacity: 1; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }

  .nav-rec {
    display: flex; align-items: center; gap: 7px;
    padding: 4px 12px; background: #f871711a;
    border: 1px solid #f8717140; border-radius: 20px;
    font-size: 13px; font-weight: 700; color: var(--error);
  }
  .rec-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--error); animation: pulse 1s ease-in-out infinite; }

  /* ── Live chip ── */
  .live-chip {
    font-size: 9px; font-weight: 800; letter-spacing: .5px;
    padding: 2px 6px; border-radius: 4px;
    background: #f871711a; color: var(--error); border: 1px solid #f8717140;
  }

  /* ── Content ── */
  .content { flex: 1; max-width: 680px; width: 100%; margin: 0 auto; padding: 28px 20px 48px; display: flex; flex-direction: column; gap: 16px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; animation: fadeSlideIn .3s ease both; }
  .card-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--text-3); margin-bottom: 12px; }
  .card-label svg { width: 14px; height: 14px; }

  .url-text { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: var(--accent); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; word-break: break-all; line-height: 1.6; max-height: 72px; overflow-y: auto; }

  .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 480px) { .settings-grid { grid-template-columns: 1fr; } }

  .field { display: flex; flex-direction: column; gap: 7px; }
  .field label { font-size: 11px; color: var(--text-2); font-weight: 500; }

  .input-row { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px; transition: border-color var(--transition), box-shadow var(--transition); }
  .input-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .text-input { flex: 1; background: transparent; border: none; color: var(--text); font-size: 13px; padding: 9px 0; outline: none; }
  .text-input:disabled { opacity: .5; }
  .ext { font-size: 12px; color: var(--text-3); flex-shrink: 0; }

  .slider-row { display: flex; align-items: center; gap: 10px; }
  .slider { flex: 1; -webkit-appearance: none; height: 4px; border-radius: 2px; background: var(--surface-3); outline: none; }
  .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent-grad); cursor: pointer; box-shadow: 0 0 6px #5b9df650; }
  .slider:disabled { opacity: .4; }
  .slider-val { font-size: 14px; font-weight: 700; color: var(--accent); min-width: 20px; text-align: center; }

  .quality-section { margin-top: 16px; }
  .quality-label { display: block; font-size: 11px; color: var(--text-2); font-weight: 500; margin-bottom: 9px; }
  .quality-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .quality-chip { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); font-size: 12px; font-weight: 500; transition: all var(--transition); }
  .quality-chip:not(:disabled):hover { border-color: var(--border-hi); color: var(--text); }
  .quality-chip.active { background: var(--accent-glow); border-color: var(--accent); color: var(--accent); }
  .quality-chip:disabled { opacity: .5; cursor: default; }
  .best-tag { font-size: 9px; font-weight: 800; color: var(--accent-2); background: #22d3ee15; padding: 1px 5px; border-radius: 4px; }

  .range-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }

  /* ── Buttons ── */
  .action-row { display: flex; justify-content: center; }

  .btn-main { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 16px 28px; border-radius: var(--radius-lg); background: var(--accent-grad); color: #fff; font-size: 15px; font-weight: 700; box-shadow: 0 4px 24px #5b9df640, 0 1px 0 #ffffff20 inset; transition: opacity var(--transition), transform .12s, box-shadow var(--transition); }
  .btn-main svg { width: 20px; height: 20px; }
  .btn-main:not(:disabled):hover { opacity: .9; transform: translateY(-2px); box-shadow: 0 8px 32px #5b9df660; }
  .btn-main:not(:disabled):active { transform: scale(.97); }
  .btn-main:disabled { opacity: .4; cursor: default; }
  .btn-main.done { background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 4px 24px #34d39940; }
  .btn-main.error { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 4px 24px #f8717140; }
  .btn-main.live { background: linear-gradient(135deg, #f87171, #dc2626); box-shadow: 0 4px 24px #f8717140; }

  .btn-abort { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 16px 28px; border-radius: var(--radius-lg); background: transparent; border: 1.5px solid var(--error); color: var(--error); font-size: 15px; font-weight: 700; transition: background var(--transition), transform .12s; }
  .btn-abort svg { width: 20px; height: 20px; }
  .btn-abort:hover { background: #f871711a; transform: translateY(-1px); }
  .btn-abort:active { transform: scale(.97); }

  /* ── Recording status ── */
  .rec-status {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-radius: var(--radius-lg);
    background: #f871710a; border: 1px solid #f8717130;
    font-size: 13px; color: var(--text-2);
    animation: fadeSlideIn .3s ease both;
  }
  .rec-indicator { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--error); }
  .rec-dot-anim { width: 8px; height: 8px; border-radius: 50%; background: var(--error); animation: pulse 1s ease-in-out infinite; }

  /* ── Progress ── */
  .progress-section { animation: fadeSlideIn .3s ease both; }
  .progress-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .progress-pct { font-size: 36px; font-weight: 800; line-height: 1; background: var(--accent-grad); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .progress-pct.done { background: linear-gradient(135deg, #34d399, #059669); -webkit-background-clip: text; }
  .progress-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .progress-seg { font-size: 13px; color: var(--text-2); }
  .speed-eta { font-size: 11px; color: var(--text-3); font-family: 'SFMono-Regular', Consolas, monospace; }
  .progress-track { position: relative; height: 8px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--border); overflow: hidden; }
  .progress-fill { position: absolute; inset: 0; width: 0%; border-radius: 4px; background: var(--accent-grad); transition: width .35s ease; box-shadow: 0 0 8px #5b9df650; }
  .progress-fill.done { background: linear-gradient(90deg, #34d399, #059669); }
  .progress-shimmer { position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, #ffffff22 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 1.8s linear infinite; }

  /* ── Terminal ── */
  .terminal { border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border); animation: fadeSlideIn .35s ease .1s both; }
  .terminal-bar { display: flex; align-items: center; gap: 7px; padding: 9px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
  .dot-r, .dot-y, .dot-g { width: 10px; height: 10px; border-radius: 50%; }
  .dot-r { background: #f87171; } .dot-y { background: #fbbf24; } .dot-g { background: #34d399; }
  .terminal-title { flex: 1; text-align: center; font-size: 11px; color: var(--text-3); font-weight: 500; }
  .terminal-body { padding: 14px 16px; min-height: 100px; max-height: 200px; overflow-y: auto; background: #020509; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; line-height: 1.7; display: flex; flex-direction: column; gap: 2px; }
  .log-placeholder { color: var(--text-3); }
  .log-line { display: flex; gap: 8px; }
  .log-time { color: var(--text-3); flex-shrink: 0; }
  .log-line.ok   .log-msg { color: var(--success); }
  .log-line.error .log-msg { color: var(--error); }
  .log-line.info  .log-msg { color: var(--text-2); }
</style>
