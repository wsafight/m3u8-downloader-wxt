<script lang="ts">
  import { M3U8Parser } from '../../lib/m3u8-parser';

  let {
    recCount,
    recDurSec,
    recBytes,
  }: {
    recCount: number;
    recDurSec: number;
    recBytes: number;
  } = $props();
</script>

<section class="rec-status">
  <span class="rec-indicator"><span class="rec-dot-anim"></span>录制中</span>
  <span
    >{recCount} 片 · {M3U8Parser.formatDuration(recDurSec)} · {(recBytes / 1024 / 1024).toFixed(1)} MB</span
  >
</section>

<style>
  .rec-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-radius: var(--radius-lg, 12px);
    background: #f871710a;
    border: 1px solid #f8717130;
    font-size: 13px;
    color: var(--text-2, #7a96ba);
    animation: fadeSlideIn 0.3s ease both;
  }
  .rec-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--error, #f87171);
  }
  .rec-dot-anim {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--error, #f87171);
    animation: pulse 1s ease-in-out infinite;
  }
</style>
