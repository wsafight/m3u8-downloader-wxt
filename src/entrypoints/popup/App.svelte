<script lang="ts">
  import { onMount } from 'svelte';
  import type { HistoryEntry, QueueItem, StreamInfo } from '../../lib/types';
  import { getHistory } from '../../lib/history';
  import { enqueueItem, getQueue } from '../../lib/queue';
  import { loadSettings } from '../../lib/settings';
  import type { UserSettings } from '../../lib/settings';
  import { MSG } from '../../lib/messages';
  import { i18n } from '../../lib/i18n.svelte';
  import HistoryTab from './HistoryTab.svelte';
  import QueueTab from './QueueTab.svelte';
  import SettingsTab from './SettingsTab.svelte';

  type Tab = 'streams' | 'queue' | 'history' | 'settings';

  let streams = $state<StreamInfo[]>([]);
  let tabId = $state(-1);
  let manual = $state('');
  let loading = $state(true);
  let activeTab = $state<Tab>('streams');
  let history = $state<HistoryEntry[]>([]);
  let queue = $state<QueueItem[]>([]);
  let settings = $state<UserSettings>({
    concurrency: 6, convertToMp4: false, language: 'zh', retries: 3, autoEnqueue: false,
  });

  onMount(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? -1;
    const s = await loadSettings();
    settings = s;
    i18n.lang = s.language;
    await refresh();
    loading = false;
  });

  async function refresh() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.GET_STREAMS, tabId });
      streams = (res?.streams ?? []) as StreamInfo[];
    } catch {
      streams = [];
    }
  }

  async function switchTab(t: Tab) {
    activeTab = t;
    if (t === 'history' && history.length === 0) history = await getHistory();
    if (t === 'queue') queue = await getQueue();
  }

  async function removeStream(url: string) {
    await chrome.runtime.sendMessage({ type: MSG.REMOVE_STREAM, tabId, url });
    streams = streams.filter((s) => s.url !== url);
  }

  async function clearAll() {
    await chrome.runtime.sendMessage({ type: MSG.CLEAR_STREAMS, tabId });
    streams = [];
  }

  function openDownload(url: string) {
    const q = new URLSearchParams({ url });
    chrome.tabs.create({ url: chrome.runtime.getURL('download.html') + '?' + q });
    window.close();
  }

  async function addToQueue(url: string) {
    const filename = guessFilename(url);
    await enqueueItem(url, filename);
    await chrome.runtime.sendMessage({ type: MSG.ENQUEUE });
    queue = await getQueue();
    activeTab = 'queue';
  }

  function startManual() {
    const url = manual.trim();
    if (!url) return;
    openDownload(url);
  }

  function parseUrl(raw: string): { host: string; path: string } {
    try {
      const u = new URL(raw);
      const path = u.pathname.length > 42 ? '…' + u.pathname.slice(-40) : u.pathname;
      return { host: u.hostname, path };
    } catch {
      return { host: '', path: raw.slice(0, 45) };
    }
  }

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return i18n.t('timeAgoSec', s);
    if (s < 3600) return i18n.t('timeAgoMin', Math.floor(s / 60));
    return i18n.t('timeAgoHour', Math.floor(s / 3600));
  }

  function guessFilename(url: string): string {
    try {
      const path = new URL(url).pathname;
      return (
        path
          .split('/')
          .filter(Boolean)
          .slice(-2)
          .join('_')
          .replace(/\.m3u8.*$/i, '')
          .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
          .slice(0, 60) || 'video'
      );
    } catch {
      return 'video';
    }
  }

  const pendingCount = $derived(queue.filter((i) => i.status === 'pending').length);

  // ── Batch selection ───────────────────────────────────────────────
  let selectedUrls = $state<Set<string>>(new Set());
  const allSelected = $derived(
    streams.length > 0 && streams.every((s) => selectedUrls.has(s.url)),
  );

  function toggleSelect(url: string) {
    const next = new Set(selectedUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    selectedUrls = next;
  }

  function toggleSelectAll() {
    if (allSelected) {
      selectedUrls = new Set();
    } else {
      selectedUrls = new Set(streams.map((s) => s.url));
    }
  }

  async function addSelectedToQueue() {
    for (const url of selectedUrls) {
      const fn = guessFilename(url);
      await enqueueItem(url, fn);
    }
    await chrome.runtime.sendMessage({ type: MSG.ENQUEUE });
    queue = await getQueue();
    selectedUrls = new Set();
    activeTab = 'queue';
  }

  // ── Stream Preview ────────────────────────────────────────────────
  let previewUrl = $state<string | null>(null);

  function togglePreview(url: string) {
    previewUrl = previewUrl === url ? null : url;
  }

  function previewAction(node: HTMLVideoElement, url: string) {
    let hls: any;
    (async () => {
      try {
        const HlsModule = await import('hls.js');
        const Hls = HlsModule.default;
        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: false });
          hls.loadSource(url);
          hls.attachMedia(node);
          node.play().catch(() => {});
        } else if (node.canPlayType('application/vnd.apple.mpegurl')) {
          node.src = url;
          node.play().catch(() => {});
        }
      } catch {
        /* preview unavailable */
      }
    })();
    return {
      destroy() {
        hls?.destroy();
        node.pause();
        node.removeAttribute('src');
      },
    };
  }
</script>

<!-- ─────────────────────────────────── MARKUP ─ -->
<div class="app">
  <!-- Header -->
  <header>
    <div class="logo">
      <svg class="logo-icon" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="url(#lg)" />
        <path
          d="M10 22V10l6 5 6-5v12"
          stroke="#fff"
          stroke-width="2.2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stop-color="#5b9df6" />
            <stop offset="100%" stop-color="#22d3ee" />
          </linearGradient>
        </defs>
      </svg>
      <span class="logo-text">M3U8 <em>Downloader</em></span>
    </div>
    {#if activeTab === 'streams'}
      <div class="header-actions">
        {#if streams.length > 0}
          <button class="icon-btn select-all-btn" onclick={toggleSelectAll} title={allSelected ? i18n.t('cancelSelectAll') : i18n.t('selectAll')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              {#if allSelected}
                <rect x="3" y="3" width="18" height="18" rx="2" fill="var(--accent)" stroke="var(--accent)"/>
                <path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5"/>
              {:else}
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              {/if}
            </svg>
          </button>
        {/if}
        <button class="icon-btn" onclick={clearAll} disabled={streams.length === 0} title={i18n.t('clearAll')}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        </button>
      </div>
    {/if}
  </header>

  <!-- Tab Bar -->
  <nav class="tabs">
    <button class="tab" class:active={activeTab === 'streams'} onclick={() => switchTab('streams')}>
      {i18n.t('tabStreams')}
      {#if streams.length > 0}<span class="tab-badge">{streams.length}</span>{/if}
    </button>
    <button class="tab" class:active={activeTab === 'queue'} onclick={() => switchTab('queue')}>
      {i18n.t('tabQueue')}
      {#if pendingCount > 0}<span class="tab-badge">{pendingCount}</span>{/if}
    </button>
    <button class="tab" class:active={activeTab === 'history'} onclick={() => switchTab('history')}>
      {i18n.t('tabHistory')}
    </button>
    <button class="tab tab-icon" class:active={activeTab === 'settings'} onclick={() => switchTab('settings')} title={i18n.t('tabSettings')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </button>
  </nav>

  <!-- Stream List -->
  {#if activeTab === 'streams'}
    <main>
      {#if loading}
        <div class="center"><div class="spinner"></div></div>
      {:else if streams.length === 0}
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 64 64" fill="none">
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="var(--border-hi)"
                stroke-width="2"
                stroke-dasharray="6 4"
              />
              <path
                d="M20 32a12 12 0 0124 0"
                stroke="var(--accent)"
                stroke-width="2.5"
                stroke-linecap="round"
              />
              <path
                d="M14 32a18 18 0 0136 0"
                stroke="var(--accent)"
                stroke-width="2"
                stroke-linecap="round"
                opacity=".5"
              />
              <path
                d="M8 32a24 24 0 0148 0"
                stroke="var(--accent)"
                stroke-width="1.5"
                stroke-linecap="round"
                opacity=".25"
              />
              <circle cx="32" cy="32" r="3" fill="var(--accent)" />
            </svg>
          </div>
          <p class="empty-title">{i18n.t('streamEmpty')}</p>
          <p class="empty-hint">{i18n.t('streamEmptyHint')}</p>
        </div>
      {:else}
        <ul class="stream-list">
          {#each streams as stream, i (stream.url)}
            {@const info = parseUrl(stream.url)}
            <li class="stream-card" class:selected={selectedUrls.has(stream.url)} style="animation-delay: {i * 40}ms">
              <div class="stream-row">
                <button
                  class="stream-checkbox"
                  class:checked={selectedUrls.has(stream.url)}
                  onclick={() => toggleSelect(stream.url)}
                  title={selectedUrls.has(stream.url) ? '取消选择' : '选择'}
                  aria-label="select stream"
                >
                  {#if selectedUrls.has(stream.url)}
                    <svg viewBox="0 0 16 16" fill="none">
                      <rect width="16" height="16" rx="3" fill="var(--accent)"/>
                      <path d="M4 8l2.5 2.5L12 5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {:else}
                    <svg viewBox="0 0 16 16" fill="none">
                      <rect x="0.5" y="0.5" width="15" height="15" rx="2.5" stroke="var(--border-hi)"/>
                    </svg>
                  {/if}
                </button>
                <div class="stream-thumb">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                    <polygon points="10 8 16 11 10 14 10 8" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <div class="stream-info">
                  <span class="stream-host">{info.host}</span>
                  <span class="stream-path" title={stream.url}>{info.path}</span>
                  <span class="stream-time">{timeAgo(stream.detectedAt)}</span>
                </div>
                <div class="stream-actions">
                  <button
                    class="btn-preview"
                    class:active={previewUrl === stream.url}
                    onclick={() => togglePreview(stream.url)}
                    title={previewUrl === stream.url ? i18n.t('stopPreview') : i18n.t('preview')}
                  >
                    {#if previewUrl === stream.url}
                      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <rect x="6" y="6" width="12" height="12" rx="1.5" />
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    {/if}
                  </button>
                  <button class="btn-dl" onclick={() => openDownload(stream.url)} title={i18n.t('directDownload')}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                    >
                      <path d="M12 3v13M5 13l7 7 7-7" /><path d="M3 20h18" />
                    </svg>
                  </button>
                  <button class="btn-queue" onclick={() => addToQueue(stream.url)} title={i18n.t('addToQueue')}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    >
                      <path d="M3 6h18M3 12h18M3 18h12" /><path d="M19 15l3 3-3 3" />
                    </svg>
                  </button>
                  <button class="btn-rm" onclick={() => removeStream(stream.url)} title={i18n.t('removeStream')}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {#if previewUrl === stream.url}
                <div class="preview-wrap">
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video
                    class="preview-video"
                    use:previewAction={stream.url}
                    controls
                    playsinline
                    muted
                  ></video>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </main>

    <!-- Batch queue button -->
    {#if selectedUrls.size > 0}
      <div class="batch-bar">
        <span class="batch-info">{i18n.t('selected')} {selectedUrls.size} {i18n.t('streams')}</span>
        <button class="btn-batch-queue" onclick={addSelectedToQueue}>
          {i18n.t('batchQueue')} ({selectedUrls.size})
        </button>
      </div>
    {/if}

    <!-- Manual Input -->
    <footer>
      <div class="input-wrap">
        <svg
          class="input-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
        <input
          class="url-input"
          bind:value={manual}
          placeholder={i18n.t('manualUrl')}
          spellcheck="false"
          onkeydown={(e) => e.key === 'Enter' && startManual()}
        />
      </div>
      <button class="btn-go" onclick={startManual} disabled={!manual.trim()} aria-label="开始下载">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </footer>
  {:else if activeTab === 'queue'}
    <main><QueueTab bind:items={queue} /></main>
  {:else if activeTab === 'history'}
    <main><HistoryTab bind:entries={history} /></main>
  {:else}
    <main><SettingsTab bind:settings={settings} /></main>
  {/if}
</div>

<!-- ─────────────────────────────────── STYLES ─ -->
<style>
  .app {
    width: 400px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
    max-height: 580px;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .logo-icon {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }
  .logo-text {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.3px;
  }
  .logo-text em {
    font-style: normal;
    background: var(--accent-grad);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-3);
    transition:
      background var(--transition),
      color var(--transition);
  }
  .icon-btn svg {
    width: 15px;
    height: 15px;
  }
  .icon-btn:not(:disabled):hover {
    background: var(--surface-3);
    color: var(--error);
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    flex-shrink: 0;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 8px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    border-bottom: 2px solid transparent;
    transition:
      color 0.15s,
      border-color 0.15s;
  }
  .tab:hover {
    color: var(--text-2);
  }
  .tab.active {
    color: var(--accent);
    border-color: var(--accent);
  }

  .tab-icon {
    flex: 0 0 36px;
    padding: 0;
  }
  .tab-icon svg {
    width: 14px;
    height: 14px;
  }

  .tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent-grad);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
  }

  /* ── Main content ── */
  main {
    flex: 1;
    overflow-y: auto;
    min-height: 80px;
  }

  .center {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--border-hi);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    gap: 10px;
  }
  .empty-icon svg {
    width: 64px;
    height: 64px;
    animation: pulse 3s ease-in-out infinite;
  }
  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
  }
  .empty-hint {
    font-size: 11px;
    color: var(--text-3);
  }

  .stream-list {
    list-style: none;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stream-card {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border);
    animation: fadeSlideIn 0.25s ease both;
    transition:
      border-color var(--transition),
      background var(--transition),
      box-shadow var(--transition);
  }
  .stream-card:hover {
    background: var(--surface-3);
    border-color: var(--border-hi);
    box-shadow: 0 0 0 1px var(--accent-glow);
  }

  .stream-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .preview-wrap {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .preview-video {
    width: 100%;
    display: block;
    border-radius: 5px;
    background: #000;
    max-height: 200px;
    object-fit: contain;
  }

  .stream-thumb {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--surface-3);
    border: 1px solid var(--border-hi);
    color: var(--accent);
  }
  .stream-thumb svg {
    width: 16px;
    height: 16px;
  }

  .stream-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stream-host {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stream-path {
    font-size: 11px;
    color: var(--accent);
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'SFMono-Regular', 'Consolas', monospace;
  }
  .stream-time {
    font-size: 10px;
    color: var(--text-3);
  }

  .stream-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .btn-dl,
  .btn-queue,
  .btn-rm,
  .btn-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    transition:
      background var(--transition),
      color var(--transition),
      transform 0.1s;
  }
  .btn-dl svg,
  .btn-queue svg,
  .btn-rm svg,
  .btn-preview svg {
    width: 14px;
    height: 14px;
  }

  .btn-preview {
    background: transparent;
    color: var(--text-3);
    border: 1px solid transparent;
  }
  .btn-preview:hover {
    background: #22d3ee15;
    color: var(--accent);
    border-color: var(--border-hi);
  }
  .btn-preview.active {
    background: #22d3ee20;
    color: var(--accent);
    border-color: var(--border-hi);
  }

  .btn-dl {
    background: var(--accent-glow);
    color: var(--accent);
    border: 1px solid var(--border-hi);
  }
  .btn-dl:hover {
    background: var(--accent);
    color: #fff;
    transform: translateY(-1px);
  }
  .btn-dl:active {
    transform: scale(0.92);
  }

  .btn-queue {
    background: transparent;
    color: var(--text-3);
    border: 1px solid transparent;
  }
  .btn-queue:hover {
    background: #5b9df615;
    color: var(--accent);
    border-color: var(--border-hi);
  }

  .btn-rm {
    background: transparent;
    color: var(--text-3);
    border: 1px solid transparent;
  }
  .btn-rm:hover {
    background: #f871711a;
    color: var(--error);
    border-color: #f8717130;
  }
  .btn-rm:active {
    transform: scale(0.9);
  }

  /* ── Footer ── */
  footer {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    background: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 10px;
    transition:
      border-color var(--transition),
      box-shadow var(--transition);
  }
  .input-wrap:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .input-icon {
    width: 14px;
    height: 14px;
    color: var(--text-3);
    flex-shrink: 0;
  }
  .url-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 12px;
    padding: 7px 0;
    outline: none;
  }
  .url-input::placeholder {
    color: var(--text-3);
  }
  .btn-go {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--accent-grad);
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 2px 12px #5b9df640;
    transition:
      opacity var(--transition),
      transform 0.1s;
  }
  .btn-go svg {
    width: 16px;
    height: 16px;
  }
  .btn-go:not(:disabled):hover {
    opacity: 0.85;
    transform: translateY(-1px);
  }
  .btn-go:not(:disabled):active {
    transform: scale(0.92);
  }
  .btn-go:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* ── Header actions ── */
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .select-all-btn svg {
    width: 15px;
    height: 15px;
  }

  /* ── Stream checkbox ── */
  .stream-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .stream-checkbox svg {
    width: 16px;
    height: 16px;
  }

  .stream-card.selected {
    border-color: var(--accent);
    background: var(--surface-3);
  }

  /* ── Batch bar ── */
  .batch-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    animation: fadeSlideIn 0.2s ease both;
    flex-shrink: 0;
  }
  .batch-info {
    font-size: 11px;
    color: var(--text-2);
  }
  .btn-batch-queue {
    padding: 5px 14px;
    border-radius: var(--radius);
    background: var(--accent-grad);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    box-shadow: 0 2px 8px #5b9df630;
    transition: opacity var(--transition);
  }
  .btn-batch-queue:hover {
    opacity: 0.85;
  }
</style>
