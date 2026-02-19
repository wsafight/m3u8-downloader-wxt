<script lang="ts">
  import type { DownloadPhase } from '../../lib/types';
  import { i18n } from '../../lib/i18n.svelte';

  let {
    phase,
    pct,
    segDone,
    segTotal,
    speedLabel,
    etaLabel,
    isRunning,
  }: {
    phase: DownloadPhase;
    pct: number;
    segDone: number;
    segTotal: number;
    speedLabel: string;
    etaLabel: string;
    isRunning: boolean;
  } = $props();

  function phaseLabel(p: DownloadPhase): string {
    switch (p) {
      case 'prefetching': return i18n.t('phasePrefetching');
      case 'downloading': return i18n.t('phaseDownloading');
      case 'merging':     return i18n.t('phaseMerging');
      case 'partial':     return i18n.t('phasePartial');
      case 'recording':   return i18n.t('phaseRecording');
      case 'stopping':    return i18n.t('phaseStopping');
      case 'done':        return i18n.t('phaseDone');
      case 'error':       return i18n.t('phaseError');
      case 'aborted':     return i18n.t('phaseAborted');
      default:            return '';
    }
  }
</script>

<section class="progress-section">
  <div class="progress-header">
    <span class="progress-pct" class:done={phase === 'done'}>{pct}%</span>
    <div class="progress-right">
      {#if segTotal > 0}
        <span class="progress-seg">{segDone} / {segTotal} {i18n.t('segs')}</span>
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

<style>
  .progress-section {
    background: var(--surface, #f8fafc);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: var(--radius-lg, 12px);
    padding: 18px 20px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    animation: fadeSlideIn 0.3s ease both;
  }
  .progress-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .progress-pct {
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -1px;
    background: var(--accent-grad, linear-gradient(135deg, #2563eb, #3b82f6));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .progress-pct.done {
    background: linear-gradient(135deg, #16a34a, #34d399);
    -webkit-background-clip: text;
  }
  .progress-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .progress-seg {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #475569);
  }
  .speed-eta {
    font-size: 11px;
    color: var(--text-3, #94a3b8);
    font-family: 'SFMono-Regular', Consolas, monospace;
    background: var(--surface-2, #f1f5f9);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 4px;
    padding: 2px 7px;
  }
  .progress-track {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-3, #e2e8f0);
    border: 1px solid var(--border, #e2e8f0);
    overflow: hidden;
    margin-top: 4px;
  }
  .progress-fill {
    position: absolute;
    inset: 0;
    width: 0%;
    border-radius: 4px;
    background: var(--accent-grad, linear-gradient(135deg, #2563eb, #3b82f6));
    transition: width 0.35s ease;
    box-shadow: 0 0 8px rgba(37, 99, 235, 0.3);
  }
  .progress-fill.done {
    background: linear-gradient(90deg, #16a34a, #34d399);
    box-shadow: 0 0 8px rgba(22, 163, 74, 0.3);
  }
  .progress-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, #ffffff22 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 1.8s linear infinite;
  }
</style>
