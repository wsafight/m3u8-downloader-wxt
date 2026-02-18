<script lang="ts">
  import type { SegmentStatus } from '../../lib/types';

  let {
    segStatuses,
    failedCount,
    okCount,
  }: {
    segStatuses: SegmentStatus[];
    failedCount: number;
    okCount: number;
  } = $props();

  const MAX_DISPLAY_DOTS = 400;

  const displayDots = $derived.by<SegmentStatus[]>(() => {
    if (segStatuses.length === 0) return [];
    if (segStatuses.length <= MAX_DISPLAY_DOTS) return segStatuses;
    const ratio = segStatuses.length / MAX_DISPLAY_DOTS;
    const dots: SegmentStatus[] = [];
    for (let i = 0; i < MAX_DISPLAY_DOTS; i++) {
      const s = Math.floor(i * ratio);
      const e = Math.floor((i + 1) * ratio);
      const group = segStatuses.slice(s, e);
      dots.push(group.includes('failed') ? 'failed' : group.includes('pending') ? 'pending' : 'ok');
    }
    return dots;
  });
</script>

{#if displayDots.length > 0}
  <section class="seg-grid-section">
    <div class="seg-grid-header">
      <span class="seg-grid-title">分片状态</span>
      <div class="seg-grid-legend">
        {#if failedCount > 0}
          <span class="legend-item failed"><span class="legend-dot"></span>{failedCount} 失败</span>
        {/if}
        <span class="legend-item ok"><span class="legend-dot"></span>{okCount} 完成</span>
        {#if segStatuses.length > MAX_DISPLAY_DOTS}
          <span class="legend-scale"
            >（每点代表 {Math.ceil(segStatuses.length / MAX_DISPLAY_DOTS)} 片）</span
          >
        {/if}
      </div>
    </div>
    <div class="seg-grid">
      {#each displayDots as status}
        <span class="seg-dot {status}"></span>
      {/each}
    </div>
  </section>
{/if}

<style>
  .seg-grid-section {
    animation: fadeSlideIn 0.3s ease both;
  }
  .seg-grid-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .seg-grid-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-3, #3d5878);
  }
  .seg-grid-legend {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-3, #3d5878);
  }
  .legend-item.failed {
    color: var(--error, #f87171);
  }
  .legend-item.ok {
    color: var(--success, #34d399);
  }
  .legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 1px;
    background: currentColor;
  }
  .legend-scale {
    font-size: 10px;
    color: var(--text-3, #3d5878);
  }
  .seg-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .seg-dot {
    width: 6px;
    height: 6px;
    border-radius: 1px;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .seg-dot.pending {
    background: var(--surface-3, #162240);
  }
  .seg-dot.ok {
    background: var(--success, #34d399);
  }
  .seg-dot.failed {
    background: var(--error, #f87171);
  }
</style>
