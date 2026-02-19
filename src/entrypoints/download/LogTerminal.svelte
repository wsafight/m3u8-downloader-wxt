<script lang="ts">
  import type { LogEntry } from '../../lib/types';
  import { i18n } from '../../lib/i18n.svelte';

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
    <span class="terminal-title">{i18n.t('logTitle')}</span>
  </div>
  <div class="terminal-body" bind:this={logEl}>
    {#if logs.length === 0}
      <span class="log-placeholder">{i18n.t('logWaiting')}</span>
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
    border: 1px solid #1e293b;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.22),
      0 2px 8px rgba(0, 0, 0, 0.12),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    animation: fadeSlideIn 0.35s ease 0.1s both;
  }
  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
  }
  .dot-r,
  .dot-y,
  .dot-g {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-r {
    background: #fc605c;
    box-shadow: 0 0 5px rgba(252, 96, 92, 0.6);
  }
  .dot-y {
    background: #fdbc40;
    box-shadow: 0 0 5px rgba(253, 188, 64, 0.6);
  }
  .dot-g {
    background: #34c84a;
    box-shadow: 0 0 5px rgba(52, 200, 74, 0.6);
  }
  .terminal-title {
    flex: 1;
    text-align: center;
    font-size: 11px;
    color: #475569;
    font-weight: 500;
    letter-spacing: 0.3px;
  }
  .terminal-body {
    padding: 14px 16px;
    min-height: 100px;
    max-height: 220px;
    overflow-y: auto;
    background: #080d16;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 12px;
    line-height: 1.75;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .log-placeholder {
    color: #334155;
    font-style: italic;
  }
  .log-line {
    display: flex;
    gap: 8px;
  }
  .log-time {
    color: #334155;
    flex-shrink: 0;
    user-select: none;
  }
  .log-line.ok .log-msg {
    color: #4ade80;
  }
  .log-line.warn .log-msg {
    color: #fbbf24;
  }
  .log-line.error .log-msg {
    color: #f87171;
  }
  .log-line.info .log-msg {
    color: #93c5fd;
  }
</style>
