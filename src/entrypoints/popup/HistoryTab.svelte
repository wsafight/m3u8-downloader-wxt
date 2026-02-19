<script lang="ts">
  import type { HistoryEntry } from '../../lib/types';
  import { clearHistory, removeHistoryEntry } from '../../lib/history';
  import { i18n } from '../../lib/i18n.svelte';

  let { entries = $bindable<HistoryEntry[]>([]) } = $props();

  function formatBytes(b: number): string {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return i18n.t('timeAgoSec', s);
    if (s < 3600) return i18n.t('timeAgoMin', Math.floor(s / 60));
    if (s < 86400) return i18n.t('timeAgoHour', Math.floor(s / 3600));
    return i18n.t('timeAgoDay', Math.floor(s / 86400));
  }

  async function remove(id: string) {
    await removeHistoryEntry(id);
    entries = entries.filter((e) => e.id !== id);
  }

  async function clear() {
    await clearHistory();
    entries = [];
  }

  function openDomain(domain: string) {
    chrome.tabs.create({ url: `https://${domain}` });
  }

  function exportHistory() {
    const json = JSON.stringify(entries, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `m3u8-history-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
</script>

{#if entries.length === 0}
  <div class="empty">
    <svg viewBox="0 0 48 48" fill="none"
      ><circle
        cx="24"
        cy="24"
        r="20"
        stroke="var(--border-hi)"
        stroke-width="1.5"
        stroke-dasharray="4 3"
      /><path
        d="M16 24h16M24 16v16"
        stroke="var(--text-3)"
        stroke-width="2"
        stroke-linecap="round"
        opacity=".4"
      /></svg
    >
    <p>{i18n.t('historyEmpty')}</p>
  </div>
{:else}
  <div class="toolbar">
    <span class="count">{entries.length} {i18n.t('records')}</span>
    <div class="toolbar-actions">
      <button class="export-btn" onclick={exportHistory}>{i18n.t('exportHistory')}</button>
      <button class="clear-btn" onclick={clear}>{i18n.t('clearHistory')}</button>
    </div>
  </div>
  <ul class="list">
    {#each entries as e (e.id)}
      <li class="item">
        <div class="status-icon" class:ok={e.status === 'done'} class:err={e.status !== 'done'}>
          {#if e.status === 'done'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          {/if}
        </div>
        <div class="info">
          <span class="name" title={e.filename}>{e.filename}</span>
          <span class="meta">
            <button class="domain-link" onclick={() => openDomain(e.domain)} title="在新标签打开">{e.domain}</button>
            · {formatBytes(e.bytes)}{e.segments > 0 ? ` · ${e.segments} ${i18n.t('segs')}` : ''} · {timeAgo(e.doneAt)}
          </span>
        </div>
        <button class="rm" onclick={() => remove(e.id)} title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 36px 20px;
    gap: 10px;
    color: var(--text-3);
    font-size: 12px;
  }
  .empty svg {
    width: 48px;
    height: 48px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11px;
    color: var(--text-3);
  }
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .export-btn {
    font-size: 11px;
    color: var(--accent);
    background: none;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .export-btn:hover {
    background: var(--accent-glow);
    border-color: var(--border-hi);
  }
  .clear-btn {
    font-size: 11px;
    color: var(--error);
    background: none;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .clear-btn:hover {
    background: #f871711a;
    border-color: #f8717130;
  }
  .domain-link {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .domain-link:hover {
    opacity: 0.8;
  }

  .list {
    list-style: none;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .status-icon {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .status-icon svg {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
  }
  .status-icon.ok {
    background: #34d39920;
    color: var(--success);
  }
  .status-icon.err {
    background: #f8717120;
    color: var(--error);
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 10px;
    color: var(--text-3);
  }

  .rm {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: none;
    color: var(--text-3);
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .rm svg {
    width: 12px;
    height: 12px;
  }
  .rm:hover {
    background: #f871711a;
    color: var(--error);
  }
</style>
