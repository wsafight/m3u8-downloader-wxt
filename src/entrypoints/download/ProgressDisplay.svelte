<script lang="ts">
  import type { DownloadPhase } from '../../lib/types';

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
      case 'prefetching':
        return '解析中…';
      case 'downloading':
        return '下载中';
      case 'merging':
        return '合并中…';
      case 'partial':
        return '部分失败';
      case 'recording':
        return '录制中';
      case 'stopping':
        return '保存中…';
      case 'done':
        return '完成！';
      case 'error':
        return '失败';
      case 'aborted':
        return '已中止';
      default:
        return '';
    }
  }
</script>

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

<style>
  .progress-section {
    animation: fadeSlideIn 0.3s ease both;
  }
  .progress-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .progress-pct {
    font-size: 36px;
    font-weight: 800;
    line-height: 1;
    background: var(--accent-grad, linear-gradient(135deg, #5b9df6, #22d3ee));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .progress-pct.done {
    background: linear-gradient(135deg, #34d399, #059669);
    -webkit-background-clip: text;
  }
  .progress-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  .progress-seg {
    font-size: 13px;
    color: var(--text-2, #7a96ba);
  }
  .speed-eta {
    font-size: 11px;
    color: var(--text-3, #3d5878);
    font-family: 'SFMono-Regular', Consolas, monospace;
  }
  .progress-track {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-2, #111d38);
    border: 1px solid var(--border, #1a2f4e);
    overflow: hidden;
  }
  .progress-fill {
    position: absolute;
    inset: 0;
    width: 0%;
    border-radius: 4px;
    background: var(--accent-grad, linear-gradient(135deg, #5b9df6, #22d3ee));
    transition: width 0.35s ease;
    box-shadow: 0 0 8px #5b9df650;
  }
  .progress-fill.done {
    background: linear-gradient(90deg, #34d399, #059669);
  }
  .progress-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, #ffffff22 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 1.8s linear infinite;
  }
</style>
