<script lang="ts">
  import type { HistoryEntry } from '../../lib/types';
  import { clearHistory, removeHistoryEntry } from '../../lib/history';

  let { entries = $bindable<HistoryEntry[]>([]) } = $props();

  function formatBytes(b: number): string {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  async function remove(id: string) {
    await removeHistoryEntry(id);
    entries = entries.filter(e => e.id !== id);
  }

  async function clear() {
    await clearHistory();
    entries = [];
  }
</script>

{#if entries.length === 0}
  <div class="empty">
    <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="var(--border-hi)" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M16 24h16M24 16v16" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" opacity=".4"/></svg>
    <p>暂无下载记录</p>
  </div>
{:else}
  <div class="toolbar">
    <span class="count">{entries.length} 条记录</span>
    <button class="clear-btn" onclick={clear}>清空全部</button>
  </div>
  <ul class="list">
    {#each entries as e (e.id)}
      <li class="item">
        <div class="status-icon" class:ok={e.status === 'done'} class:err={e.status !== 'done'}>
          {#if e.status === 'done'}✓{:else}✗{/if}
        </div>
        <div class="info">
          <span class="name" title={e.filename}>{e.filename}</span>
          <span class="meta">{e.domain} · {formatBytes(e.bytes)} · {timeAgo(e.doneAt)}</span>
        </div>
        <button class="rm" onclick={() => remove(e.id)} title="删除">×</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 36px 20px; gap: 10px; color: var(--text-3); font-size: 12px;
  }
  .empty svg { width: 48px; height: 48px; }

  .toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px 4px; font-size: 11px; color: var(--text-3);
  }
  .clear-btn {
    font-size: 11px; color: var(--error); background: none; padding: 2px 6px;
    border: 1px solid transparent; border-radius: 4px; transition: background .15s, border-color .15s;
  }
  .clear-btn:hover { background: #f871711a; border-color: #f8717130; }

  .list { list-style: none; padding: 4px 6px; display: flex; flex-direction: column; gap: 3px; }

  .item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px;
    background: var(--surface-2); border: 1px solid var(--border);
  }

  .status-icon {
    width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700;
  }
  .status-icon.ok  { background: #34d39920; color: var(--success); }
  .status-icon.err { background: #f8717120; color: var(--error); }

  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name {
    font-size: 12px; font-weight: 600; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .meta { font-size: 10px; color: var(--text-3); }

  .rm {
    flex-shrink: 0; width: 20px; height: 20px; border-radius: 4px;
    background: none; color: var(--text-3); font-size: 14px; line-height: 1;
    transition: background .15s, color .15s;
  }
  .rm:hover { background: #f871711a; color: var(--error); }
</style>
