<script lang="ts">
  import type { DownloadPhase } from '../../lib/types';
  import { i18n } from '../../lib/i18n.svelte';

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
    onpause,
    onresume,
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
    onpause: () => void;
    onresume: () => void;
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
      {phase === 'recording' ? i18n.t('btnStopRec') : i18n.t('btnAbort')}
    </button>
    {#if phase === 'downloading'}
      <button class="btn-pause" onclick={onpause}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
        {i18n.t('btnPause')}
      </button>
    {/if}
    {#if phase === 'paused'}
      <button class="btn-resume" onclick={onresume}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {i18n.t('btnResume')}
      </button>
    {/if}
    {#if (phase === 'downloading' || phase === 'paused') && segDone > 0}
      <button
        class="btn-save-partial"
        onclick={onsavepartial}
        title={i18n.t('btnSavePartialTitle', segDone)}
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
        {i18n.t('btnSavePartial', segDone)}
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
        {i18n.t('btnRetryFailed', failedCount)}
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
        {i18n.t('btnSaveComplete', okCount)}
      </button>
    </div>
    <button class="btn-reset-small" onclick={onreset}>{i18n.t('btnReset')}</button>
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
        {i18n.t('btnDone')}
      {:else if phase === 'error'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg
        >
        {i18n.t('btnRetry')}
      {:else if phase === 'aborted'}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7" /><path d="M3 20h18" /></svg
        >
        {i18n.t('freshDownload')}
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
        {i18n.t('btnStartRec')}
      {:else}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"><path d="M12 3v13M5 13l7 7 7-7" /><path d="M3 20h18" /></svg
        >
        {i18n.t('btnStartDownload')}
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
    background: var(--accent-grad, linear-gradient(135deg, #2563eb, #3b82f6));
    color: #fff;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
    box-shadow:
      0 4px 20px rgba(37, 99, 235, 0.35),
      0 1px 0 rgba(255, 255, 255, 0.2) inset;
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
    opacity: 0.92;
    transform: translateY(-2px);
    box-shadow:
      0 10px 36px rgba(37, 99, 235, 0.45),
      0 1px 0 rgba(255, 255, 255, 0.2) inset;
  }
  .btn-main:not(:disabled):active {
    transform: scale(0.97);
  }
  .btn-main:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-main.done {
    background: linear-gradient(135deg, #16a34a, #34d399);
    box-shadow: 0 4px 20px rgba(22, 163, 74, 0.35);
  }
  .btn-main.done:not(:disabled):hover {
    box-shadow: 0 10px 36px rgba(22, 163, 74, 0.45);
  }
  .btn-main.error {
    background: linear-gradient(135deg, #dc2626, #f87171);
    box-shadow: 0 4px 20px rgba(220, 38, 38, 0.35);
  }
  .btn-main.live {
    background: linear-gradient(135deg, #dc2626, #f87171);
    box-shadow: 0 4px 20px rgba(220, 38, 38, 0.35);
  }

  .btn-abort {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 16px 28px;
    border-radius: var(--radius-lg, 12px);
    background: #fef2f2;
    border: 1.5px solid #fca5a5;
    color: #dc2626;
    font-size: 15px;
    font-weight: 700;
    transition:
      background var(--transition),
      border-color var(--transition),
      transform 0.12s,
      box-shadow var(--transition);
  }
  .btn-abort svg {
    width: 20px;
    height: 20px;
  }
  .btn-abort:hover {
    background: #fee2e2;
    border-color: #f87171;
    box-shadow: 0 4px 16px rgba(220, 38, 38, 0.15);
    transform: translateY(-1px);
  }
  .btn-abort:active {
    transform: scale(0.97);
  }

  .btn-pause,
  .btn-resume {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 13px 28px;
    border-radius: var(--radius-lg, 12px);
    font-size: 14px;
    font-weight: 700;
    transition:
      background var(--transition),
      border-color var(--transition),
      transform 0.12s,
      box-shadow var(--transition);
  }
  .btn-pause svg,
  .btn-resume svg {
    width: 18px;
    height: 18px;
  }

  .btn-pause {
    background: var(--surface-2, #111d38);
    border: 1.5px solid var(--border-hi, #2a4a7a);
    color: var(--text-2, #7a96ba);
  }
  .btn-pause:hover {
    border-color: var(--accent, #5b9df6);
    color: var(--accent, #5b9df6);
    background: var(--accent-glow, #5b9df630);
    transform: translateY(-1px);
  }
  .btn-pause:active {
    transform: scale(0.97);
  }

  .btn-resume {
    background: linear-gradient(135deg, #16a34a, #34d399);
    color: #fff;
    border: none;
    box-shadow: 0 4px 20px rgba(22, 163, 74, 0.3);
  }
  .btn-resume:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 8px 28px rgba(22, 163, 74, 0.4);
  }
  .btn-resume:active {
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
