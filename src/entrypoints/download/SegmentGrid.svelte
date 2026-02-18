<script lang="ts">
  import type { SegmentStatus } from '../../lib/types';
  import { i18n } from '../../lib/i18n.svelte';

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
  const VIRTUAL_THRESHOLD = 500;
  const DOTS_PER_ROW = 40;
  const DOT_SIZE = 8; // px including gap
  const CONTAINER_HEIGHT = 200; // px
  const BUFFER_ROWS = 2;

  // Compute display dots (sampled if too many)
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

  // Virtual scroll state
  let scrollTop = $state(0);
  const useVirtual = $derived(displayDots.length > VIRTUAL_THRESHOLD);
  const totalRows = $derived(Math.ceil(displayDots.length / DOTS_PER_ROW));
  const totalHeight = $derived(totalRows * DOT_SIZE);

  const visibleRows = $derived.by(() => {
    if (!useVirtual) return null;
    const startRow = Math.max(0, Math.floor(scrollTop / DOT_SIZE) - BUFFER_ROWS);
    const endRow = Math.min(
      totalRows,
      Math.ceil((scrollTop + CONTAINER_HEIGHT) / DOT_SIZE) + BUFFER_ROWS,
    );
    const rows: Array<{ y: number; dots: SegmentStatus[] }> = [];
    for (let r = startRow; r < endRow; r++) {
      const start = r * DOTS_PER_ROW;
      const end = Math.min(start + DOTS_PER_ROW, displayDots.length);
      rows.push({ y: r * DOT_SIZE, dots: displayDots.slice(start, end) });
    }
    return rows;
  });

  function onScroll(e: Event) {
    scrollTop = (e.target as HTMLElement).scrollTop;
  }
</script>

{#if displayDots.length > 0}
  <section class="seg-grid-section">
    <div class="seg-grid-header">
      <span class="seg-grid-title">{i18n.t('segStatusTitle')}</span>
      <div class="seg-grid-legend">
        {#if failedCount > 0}
          <span class="legend-item failed"><span class="legend-dot"></span>{failedCount} {i18n.t('legendFailed')}</span>
        {/if}
        <span class="legend-item ok"><span class="legend-dot"></span>{okCount} {i18n.t('legendDone')}</span>
        {#if segStatuses.length > MAX_DISPLAY_DOTS}
          <span class="legend-scale">{i18n.t('legendScaleHint', Math.ceil(segStatuses.length / MAX_DISPLAY_DOTS))}</span>
        {/if}
      </div>
    </div>

    {#if useVirtual && visibleRows !== null}
      <!-- Virtual scroll container -->
      <div
        class="seg-grid-virtual"
        style="height: {CONTAINER_HEIGHT}px; overflow-y: auto;"
        onscroll={onScroll}
      >
        <div style="height: {totalHeight}px; position: relative;">
          {#each visibleRows as row (row.y)}
            <div
              class="seg-grid-row"
              style="position: absolute; top: {row.y}px; left: 0; display: flex; gap: 2px;"
            >
              {#each row.dots as status}
                <span class="seg-dot {status}"></span>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="seg-grid">
        {#each displayDots as status}
          <span class="seg-dot {status}"></span>
        {/each}
      </div>
    {/if}
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
  .seg-grid-virtual {
    overflow-y: auto;
    border-radius: var(--radius, 6px);
    scrollbar-width: thin;
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
