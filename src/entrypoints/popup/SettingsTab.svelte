<script lang="ts">
  import { i18n } from '../../lib/i18n.svelte';
  import { saveSettings, resetSettings } from '../../lib/settings';
  import type { UserSettings } from '../../lib/settings';

  let { settings = $bindable<UserSettings>() }: { settings: UserSettings } = $props();

  function setLang(l: 'zh' | 'en') {
    settings.language = l;
    i18n.lang = l;
    saveSettings({ language: l }).catch(() => {});
  }

  function onConcurrencyChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    settings.concurrency = v;
    saveSettings({ concurrency: v }).catch(() => {});
  }

  function onRetriesChange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    settings.retries = v;
    saveSettings({ retries: v }).catch(() => {});
  }

  function onConvertMp4Change(e: Event) {
    const v = (e.target as HTMLInputElement).checked;
    settings.convertToMp4 = v;
    saveSettings({ convertToMp4: v }).catch(() => {});
  }

  function onAutoEnqueueChange(e: Event) {
    const v = (e.target as HTMLInputElement).checked;
    settings.autoEnqueue = v;
    saveSettings({ autoEnqueue: v }).catch(() => {});
  }

  async function doReset() {
    const fresh = await resetSettings();
    settings = fresh;
    i18n.lang = fresh.language;
  }
</script>

<div class="settings-page">

  <!-- Language -->
  <section class="section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
      </svg>
      {i18n.t('sectionLanguage')}
    </div>
    <div class="lang-toggle">
      <button
        class="lang-btn"
        class:active={i18n.lang === 'zh'}
        onclick={() => setLang('zh')}
      >
        <span class="lang-flag">中</span>
        {i18n.t('langZh')}
      </button>
      <button
        class="lang-btn"
        class:active={i18n.lang === 'en'}
        onclick={() => setLang('en')}
      >
        <span class="lang-flag">En</span>
        {i18n.t('langEn')}
      </button>
    </div>
  </section>

  <!-- Download Settings -->
  <section class="section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M12 3v13M5 13l7 7 7-7"/><path d="M3 20h18"/>
      </svg>
      {i18n.t('sectionDownload')}
    </div>

    <!-- Concurrency -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{i18n.t('concurrency')}</span>
        <span class="setting-hint">{i18n.t('concurrencyHint')}</span>
      </div>
      <div class="slider-group">
        <input
          type="range" min="1" max="16"
          value={settings.concurrency}
          oninput={onConcurrencyChange}
          class="slider"
        />
        <span class="slider-val">{settings.concurrency}</span>
      </div>
    </div>

    <!-- Retries -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{i18n.t('retries')}</span>
        <span class="setting-hint">{i18n.t('retriesHint')}</span>
      </div>
      <div class="slider-group">
        <input
          type="range" min="1" max="10"
          value={settings.retries}
          oninput={onRetriesChange}
          class="slider"
        />
        <span class="slider-val">{settings.retries}</span>
      </div>
    </div>

    <!-- Convert to MP4 -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{i18n.t('convertMp4')}</span>
        <span class="setting-hint">{i18n.t('convertMp4Hint')}</span>
      </div>
      <label class="toggle">
        <input type="checkbox" checked={settings.convertToMp4} onchange={onConvertMp4Change} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
  </section>

  <!-- Behavior -->
  <section class="section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      {i18n.t('sectionBehavior')}
    </div>

    <!-- Auto-enqueue -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{i18n.t('autoEnqueue')}</span>
        <span class="setting-hint">{i18n.t('autoEnqueueHint')}</span>
      </div>
      <label class="toggle">
        <input type="checkbox" checked={settings.autoEnqueue} onchange={onAutoEnqueueChange} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
  </section>

  <!-- About -->
  <section class="section about-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
      </svg>
      {i18n.t('sectionAbout')}
    </div>
    <div class="about-row">
      <span class="about-meta">
        <span class="about-name">M3U8 Downloader</span>
        <span class="about-ver">{i18n.t('version')} 0.2.0</span>
      </span>
      <div class="about-actions">
        <a
          class="about-link"
          href="https://github.com/search?q=m3u8-downloader-wxt"
          target="_blank"
          rel="noreferrer"
          title={i18n.t('viewSource')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
          GitHub
        </a>
        <button class="reset-btn" onclick={doReset}>{i18n.t('resetDefaults')}</button>
      </div>
    </div>
  </section>
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow-y: auto;
  }

  /* ── Section ── */
  .section {
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 0;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05), 0 1px 0 rgba(255, 255, 255, 0.8) inset;
    animation: fadeSlideIn 0.2s ease both;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    color: var(--text-2);
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 10px;
  }
  .section-header svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: var(--accent);
  }

  /* ── Language Toggle ── */
  .lang-toggle {
    display: flex;
    gap: 6px;
  }
  .lang-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1.5px solid var(--border-hi);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 500;
    transition: all var(--transition);
  }
  .lang-btn:hover {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
  }
  .lang-btn.active {
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    border-color: transparent;
    color: #fff;
    font-weight: 700;
    box-shadow: 0 2px 12px rgba(37, 99, 235, 0.3), 0 1px 0 rgba(255, 255, 255, 0.15) inset;
  }
  .lang-flag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--border);
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--border-hi);
    color: var(--text-2);
  }
  .lang-btn.active .lang-flag {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.35);
    color: #fff;
  }

  /* ── Setting Row ── */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
  }
  .setting-row + .setting-row {
    border-top: 1px solid var(--border);
  }
  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .setting-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .setting-hint {
    font-size: 10px;
    color: var(--text-3);
    line-height: 1.4;
  }

  /* ── Slider ── */
  .slider-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .slider {
    -webkit-appearance: none;
    width: 80px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    outline: none;
    cursor: pointer;
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    cursor: pointer;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15), 0 1px 4px rgba(37, 99, 235, 0.3);
    transition: transform 0.12s;
  }
  .slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
  .slider-val {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    min-width: 22px;
    text-align: center;
    background: var(--accent-light);
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 1px 5px;
  }

  /* ── About ── */
  .about-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 2px;
  }
  .about-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .about-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
  }
  .about-ver {
    font-size: 10px;
    color: var(--text-3);
    font-family: 'SFMono-Regular', Consolas, monospace;
  }
  .about-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .about-link {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border-hi);
    color: var(--text-2);
    font-size: 11px;
    font-weight: 500;
    text-decoration: none;
    transition: all var(--transition);
  }
  .about-link svg { width: 13px; height: 13px; }
  .about-link:hover {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
    text-decoration: none;
  }
  .reset-btn {
    padding: 5px 10px;
    border-radius: var(--radius);
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 11px;
    cursor: pointer;
    transition: all var(--transition);
  }
  .reset-btn:hover {
    border-color: var(--error);
    color: var(--error);
    background: var(--error-bg);
  }
</style>
