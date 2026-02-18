<script lang="ts">
  import type { Segment } from '../../lib/types';
  import { M3U8Parser } from '../../lib/m3u8-parser';

  let {
    segments,
    startIndex = $bindable(0),
    endIndex   = $bindable(0),
    disabled   = false,
  }: {
    segments:   Segment[];
    startIndex: number;
    endIndex:   number;
    disabled:   boolean;
  } = $props();

  const total = $derived(segments.length);

  // Cumulative duration at each index boundary
  const cumDur = $derived(() => {
    const arr = [0];
    for (const s of segments) arr.push(arr[arr.length - 1] + s.duration);
    return arr;
  });

  const startTime = $derived(M3U8Parser.formatDuration(cumDur()[startIndex]));
  const endTime   = $derived(M3U8Parser.formatDuration(cumDur()[endIndex + 1] ?? cumDur()[total]));
  const selCount  = $derived(endIndex - startIndex + 1);
  const selDur    = $derived(M3U8Parser.formatDuration(
    (cumDur()[endIndex + 1] ?? cumDur()[total]) - cumDur()[startIndex]
  ));

  function clampStart(v: number) {
    startIndex = Math.min(Math.max(0, v), endIndex);
  }
  function clampEnd(v: number) {
    endIndex = Math.max(Math.min(total - 1, v), startIndex);
  }

  // Track fill style
  const fillLeft  = $derived(`${(startIndex / (total - 1)) * 100}%`);
  const fillRight = $derived(`${100 - (endIndex / (total - 1)) * 100}%`);
</script>

<div class="range-wrap">
  <div class="range-label">
    <span>分片范围</span>
    <span class="range-info">{selCount} 片 · {selDur}</span>
  </div>

  <div class="slider-container">
    <div class="track">
      <div class="fill" style="left:{fillLeft}; right:{fillRight}"></div>
    </div>
    <input
      type="range" class="thumb thumb-start"
      min={0} max={total - 1} step={1}
      value={startIndex}
      oninput={(e) => clampStart(+(e.target as HTMLInputElement).value)}
      {disabled}
    />
    <input
      type="range" class="thumb thumb-end"
      min={0} max={total - 1} step={1}
      value={endIndex}
      oninput={(e) => clampEnd(+(e.target as HTMLInputElement).value)}
      {disabled}
    />
  </div>

  <div class="time-labels">
    <span>{startTime}</span>
    <span>{endTime}</span>
  </div>
</div>

<style>
  .range-wrap { display: flex; flex-direction: column; gap: 8px; }

  .range-label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; color: var(--text-2); font-weight: 500;
  }
  .range-info { color: var(--accent); font-weight: 600; }

  .slider-container {
    position: relative; height: 20px;
    display: flex; align-items: center;
  }

  .track {
    position: absolute; left: 0; right: 0; height: 4px;
    background: var(--surface-3); border-radius: 2px; overflow: hidden;
  }
  .fill {
    position: absolute; top: 0; bottom: 0;
    background: var(--accent-grad);
  }

  .thumb {
    position: absolute; width: 100%; height: 4px;
    -webkit-appearance: none; appearance: none;
    background: transparent; outline: none; pointer-events: none;
    margin: 0;
  }
  .thumb::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--accent-grad);
    box-shadow: 0 0 6px #5b9df650;
    pointer-events: all; cursor: pointer;
  }
  .thumb:disabled::-webkit-slider-thumb { opacity: .4; cursor: default; }

  .time-labels {
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--text-3);
    font-family: 'SFMono-Regular', Consolas, monospace;
  }
</style>
