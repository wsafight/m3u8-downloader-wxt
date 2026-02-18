<script lang="ts">
  import type { DownloadPhase } from '../../lib/types';

  let {
    phase,
    isRunning,
    isPartial,
    isLive,
    canStart,
    segDone,
    okCount,
    failedCount,
    onstart,
    onabort,
    onretryfailed,
    onsavepartial,
    onreset,
  }: {
    phase: DownloadPhase;
    isRunning: boolean;
    isPartial: boolean;
    isLive: boolean;
    canStart: boolean;
    segDone: number;
    okCount: number;
    failedCount: number;
    onstart: () => void;
    onabort: () => void;
    onretryfailed: () => void;
    onsavepartial: () => void;
    onreset: () => void;
  } = $props();
</script>

<div class="action-row">
  {#if isRunning}
    <button class="btn-abort" onclick={onabort}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
      >
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
      {phase === 'recording' ? '停止录制' : '中止'}
    </button>
    {#if phase === 'downloading' && segDone > 0}
      <button
        class="btn-save-partial"
        onclick={onsavepartial}
        title="保存当前已完成的 {segDone} 个分片（不中断下载）"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline
            points="17 21 17 13 7 13 7 21"
          /><polyline points="7 3 7 8 15 8" /></svg
        >
        保存已完成 ({segDone})
      </button>
    {/if}
  {:else if isPartial}
    <div class="partial-actions">
      <button class="btn-retry-failed" onclick={onretryfailed}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg
        >
        重新下载失败片段 ({failedCount})
      </button>
      <button class="btn-save-partial-main" onclick={onsavepartial} disabled={okCount === 0}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline
            points="17 21 17 13 7 13 7 21"
          /><polyline points="7 3 7 8 15 8" /></svg
        >
        保存已完成片段 ({okCount})
      </button>
    </div>
    <button class="btn-reset-small" onclick={onreset}>重新开始</button>
  {:else}
    <button
      class="btn-main"
      class:done={phase === 'done'}
      class:error={phase === 'error'}
      class:live={isLive && phase === 'idle'}
      onclick={phase === 'done' || phase === 'error' || phase === 'aborted' ? onreset : onstart}
      disabled={!canStart && phase === 'idle'}
    >
      {#if phase === 'done'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M20 6L9 17l-5-5" /></svg
        >
        下载完成
      {:else if phase === 'error'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg
        >
        重试
      {:else if phase === 'aborted'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7" /><path d="M3 20h18" /></svg
        >
        重新下载
      {:else if isLive}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          ><circle cx="12" cy="12" r="3" fill="currentColor" /><circle
            cx="12"
            cy="12"
            r="7"
            opacity=".5"
          /></svg
        >
        开始录制
      {:else}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7" /><path d="M3 20h18" /></svg
        >
        开始下载
      {/if}
    </button>
  {/if}
</div>

<style>
  .action-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .btn-main {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 16px 28px;
    border-radius: var(--radius-lg, 12px);
    background: var(--accent-grad, linear-gradient(135deg, #5b9df6, #22d3ee));
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    box-shadow:
      0 4px 24px #5b9df640,
      0 1px 0 #ffffff20 inset;
    transition:
      opacity var(--transition, 0.18s ease),
      transform 0.12s,
      box-shadow var(--transition, 0.18s ease);
  }
  .btn-main svg {
    width: 20px;
    height: 20px;
  }
  .btn-main:not(:disabled):hover {
    opacity: 0.9;
    transform: translateY(-2px);
    box-shadow: 0 8px 32px #5b9df660;
  }
  .btn-main:not(:disabled):active {
    transform: scale(0.97);
  }
  .btn-main:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-main.done {
    background: linear-gradient(135deg, #34d399, #059669);
    box-shadow: 0 4px 24px #34d39940;
  }
  .btn-main.error {
    background: linear-gradient(135deg, #f87171, #dc2626);
    box-shadow: 0 4px 24px #f8717140;
  }
  .btn-main.live {
    background: linear-gradient(135deg, #f87171, #dc2626);
    box-shadow: 0 4px 24px #f8717140;
  }

  .btn-abort {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 16px 28px;
    border-radius: var(--radius-lg, 12px);
    background: transparent;
    border: 1.5px solid var(--error, #f87171);
    color: var(--error, #f87171);
    font-size: 15px;
    font-weight: 700;
    transition:
      background var(--transition),
      transform 0.12s;
  }
  .btn-abort svg {
    width: 20px;
    height: 20px;
  }
  .btn-abort:hover {
    background: #f871711a;
    transform: translateY(-1px);
  }
  .btn-abort:active {
    transform: scale(0.97);
  }

  .partial-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .btn-retry-failed {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 16px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, #f87171, #dc2626);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 4px 20px #f8717130;
    transition:
      opacity var(--transition),
      transform 0.12s;
  }
  .btn-retry-failed svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
  }
  .btn-retry-failed:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  .btn-retry-failed:active {
    transform: scale(0.97);
  }

  .btn-save-partial-main {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 16px;
    border-radius: var(--radius-lg, 12px);
    background: var(--surface-2, #111d38);
    border: 1.5px solid var(--border-hi, #2a4a7a);
    color: var(--text-2, #7a96ba);
    font-size: 13px;
    font-weight: 600;
    transition: all var(--transition);
  }
  .btn-save-partial-main svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .btn-save-partial-main:not(:disabled):hover {
    border-color: var(--accent, #5b9df6);
    color: var(--accent, #5b9df6);
    background: var(--accent-glow, #5b9df630);
  }
  .btn-save-partial-main:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-reset-small {
    width: 100%;
    padding: 9px;
    border-radius: var(--radius, 8px);
    background: transparent;
    border: 1px solid var(--border, #1a2f4e);
    color: var(--text-3, #3d5878);
    font-size: 12px;
    transition: all var(--transition);
  }
  .btn-reset-small:hover {
    border-color: var(--border-hi);
    color: var(--text-2);
  }

  .btn-save-partial {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 10px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    border: 1px solid var(--border-hi);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 600;
    transition: all var(--transition);
  }
  .btn-save-partial svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .btn-save-partial:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-glow);
  }
</style>
