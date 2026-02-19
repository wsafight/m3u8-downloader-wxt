<script lang="ts">
  import type { QueueItem } from '../../lib/types';
  import { clearDoneItems, removeQueueItem } from '../../lib/queue';
  import { i18n } from '../../lib/i18n.svelte';

  let { items = $bindable<QueueItem[]>([]) } = $props();

  function getStatusLabel(status: QueueItem['status']): string {
    const map: Record<QueueItem['status'], string> = {
      pending: i18n.t('statusPending'),
      downloading: i18n.t('statusDownloading'),
      done: i18n.t('statusDone'),
      error: i18n.t('statusError'),
    };
    return map[status];
  }

  function shortUrl(url: string): string {
    try {
      const u = new URL(url);
      const p = u.pathname.length > 36 ? '…' + u.pathname.slice(-34) : u.pathname;
      return u.hostname + p;
    } catch {
      return url.slice(0, 42);
    }
  }

  async function remove(id: string) {
    await removeQueueItem(id);
    items = items.filter((i) => i.id !== id);
  }

  async function clearDone() {
    await clearDoneItems();
    items = items.filter((i) => i.status === 'pending' || i.status === 'downloading');
  }

  const hasDone = $derived(items.some((i) => i.status === 'done' || i.status === 'error'));
</script>

{#if items.length === 0}
  <div class="empty">
    <svg viewBox="0 0 48 48" fill="none"
      ><rect
        x="8"
        y="12"
        width="32"
        height="28"
        rx="4"
        stroke="var(--border-hi)"
        stroke-width="1.5"
      /><path
        d="M16 20h16M16 28h10"
        stroke="var(--text-3)"
        stroke-width="2"
        stroke-linecap="round"
        opacity=".4"
      /></svg
    >
    <p>{i18n.t('queueEmpty')}</p>
    <span>{i18n.t('queueEmptyHint')}</span>
  </div>
{:else}
  <div class="toolbar">
    <span class="count">{items.length} {i18n.t('tasks')}</span>
    {#if hasDone}
      <button class="clear-btn" onclick={clearDone}>{i18n.t('clearDone')}</button>
    {/if}
  </div>
  <ul class="list">
    {#each items as item (item.id)}
      <li class="item">
        <div class="status-chip" data-status={item.status}>{getStatusLabel(item.status)}</div>
        <div class="info">
          <span class="fname" title={item.filename}>{item.filename}</span>
          <span class="url" title={item.url}>{shortUrl(item.url)}</span>
          {#if item.status === 'downloading' && item.progress > 0}
            <div class="prog-track">
              <div class="prog-fill" style="width:{Math.round(item.progress * 100)}%"></div>
            </div>
          {/if}
          {#if item.status === 'error' && item.errorMsg}
            <span class="err-msg">{item.errorMsg}</span>
          {/if}
        </div>
        {#if item.status === 'pending' || item.status === 'done' || item.status === 'error'}
          <button class="rm" onclick={() => remove(item.id)} title="移除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        {/if}
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
    gap: 6px;
    color: var(--text-3);
  }
  .empty svg {
    width: 48px;
    height: 48px;
    margin-bottom: 4px;
  }
  .empty p {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .empty span {
    font-size: 11px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11px;
    color: var(--text-3);
  }
  .clear-btn {
    font-size: 11px;
    color: var(--text-3);
    background: none;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    transition: background 0.15s;
  }
  .clear-btn:hover {
    background: var(--surface-3);
    color: var(--text);
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
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .status-chip {
    flex-shrink: 0;
    padding: 2px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    margin-top: 2px;
  }
  [data-status='pending'] {
    background: var(--surface-3);
    color: var(--text-3);
  }
  [data-status='downloading'] {
    background: #5b9df615;
    color: var(--accent);
  }
  [data-status='done'] {
    background: #34d39920;
    color: var(--success);
  }
  [data-status='error'] {
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
  .fname {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .url {
    font-size: 10px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
  }

  .prog-track {
    height: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    margin-top: 4px;
    overflow: hidden;
  }
  .prog-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s;
  }

  .err-msg {
    font-size: 10px;
    color: var(--error);
  }

  .rm {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    margin-top: 1px;
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
