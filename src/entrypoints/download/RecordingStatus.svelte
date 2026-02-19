<script lang="ts">
  import { M3U8Parser } from '../../lib/m3u8-parser';
  import { i18n } from '../../lib/i18n.svelte';

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
  <span class="rec-indicator"><span class="rec-dot-anim"></span>{i18n.t('phaseRecording')}</span>
  <span
    >{recCount} {i18n.t('segs')} · {M3U8Parser.formatDuration(recDurSec)} · {(recBytes / 1024 / 1024).toFixed(1)} MB</span
  >
</section>

<style>
  .rec-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-radius: var(--radius-lg, 12px);
    background: linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%);
    border: 1px solid #fecaca;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.06), 0 2px 8px rgba(220, 38, 38, 0.08);
    font-size: 13px;
    color: var(--text-2, #475569);
    font-weight: 500;
    animation: fadeSlideIn 0.3s ease both;
  }
  .rec-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    color: #dc2626;
  }
  .rec-dot-anim {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #dc2626;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.2);
    animation: pulse 1s ease-in-out infinite;
  }
</style>
