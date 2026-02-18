<script lang="ts">
  import type { LogEntry } from '../../lib/types';

  let { logs }: { logs: LogEntry[] } = $props();

  let logEl: HTMLElement;

  $effect(() => {
    // Reading logs.length creates the reactive dependency; scroll after each new entry
    if (logs.length > 0 && logEl) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  });
</script>

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

<style>
  .terminal {
    border-radius: var(--radius-lg, 12px);
    overflow: hidden;
    border: 1px solid var(--border, #1a2f4e);
    animation: fadeSlideIn 0.35s ease 0.1s both;
  }
  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px 14px;
    background: var(--surface-2, #111d38);
    border-bottom: 1px solid var(--border, #1a2f4e);
  }
  .dot-r,
  .dot-y,
  .dot-g {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot-r {
    background: #f87171;
  }
  .dot-y {
    background: #fbbf24;
  }
  .dot-g {
    background: #34d399;
  }
  .terminal-title {
    flex: 1;
    text-align: center;
    font-size: 11px;
    color: var(--text-3, #3d5878);
    font-weight: 500;
  }
  .terminal-body {
    padding: 14px 16px;
    min-height: 100px;
    max-height: 200px;
    overflow-y: auto;
    background: #020509;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 12px;
    line-height: 1.7;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .log-placeholder {
    color: var(--text-3, #3d5878);
  }
  .log-line {
    display: flex;
    gap: 8px;
  }
  .log-time {
    color: var(--text-3, #3d5878);
    flex-shrink: 0;
  }
  .log-line.ok .log-msg {
    color: var(--success, #34d399);
  }
  .log-line.warn .log-msg {
    color: var(--warn, #fbbf24);
  }
  .log-line.error .log-msg {
    color: var(--error, #f87171);
  }
  .log-line.info .log-msg {
    color: var(--text-2, #7a96ba);
  }
</style>
