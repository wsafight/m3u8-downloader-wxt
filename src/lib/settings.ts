import type { Lang } from './i18n.svelte';

export interface UserSettings {
  concurrency: number;          // 1–16
  convertToMp4: boolean;        // output format preference
  preferredResolution?: string; // remembered quality preference
  language: Lang;               // UI language
  retries: number;              // segment retry count (1–10)
  autoEnqueue: boolean;         // add to queue instead of opening download page
}

const DEFAULTS: UserSettings = {
  concurrency: 6,
  convertToMp4: false,
  language: 'zh',
  retries: 3,
  autoEnqueue: false,
};

const VALID_LANGS: Lang[] = ['zh', 'en'];

/**
 * Sanitise raw values coming from chrome.storage (could be tampered or migrated
 * from an older schema). Returns a patch that only contains valid values.
 */
function sanitise(raw: Partial<UserSettings>): Partial<UserSettings> {
  const out: Partial<UserSettings> = {};
  if (typeof raw.concurrency === 'number') {
    out.concurrency = Math.max(1, Math.min(16, Math.round(raw.concurrency)));
  }
  if (typeof raw.convertToMp4 === 'boolean') out.convertToMp4 = raw.convertToMp4;
  if (typeof raw.autoEnqueue === 'boolean') out.autoEnqueue = raw.autoEnqueue;
  if (typeof raw.retries === 'number') {
    out.retries = Math.max(0, Math.min(10, Math.round(raw.retries)));
  }
  if (typeof raw.language === 'string' && VALID_LANGS.includes(raw.language as Lang)) {
    out.language = raw.language as Lang;
  }
  if (typeof raw.preferredResolution === 'string') {
    out.preferredResolution = raw.preferredResolution;
  }
  return out;
}

// All keys that loadSettings() should fetch (includes optional fields).
const ALL_SETTING_KEYS = [...Object.keys(DEFAULTS), 'preferredResolution'];

export async function loadSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.sync.get(ALL_SETTING_KEYS);
  return { ...DEFAULTS, ...sanitise(stored as Partial<UserSettings>) };
}

export async function saveSettings(patch: Partial<UserSettings>): Promise<void> {
  const clean = sanitise(patch);
  if (Object.keys(clean).length > 0) {
    await chrome.storage.sync.set(clean);
  }
}

export async function resetSettings(): Promise<UserSettings> {
  await chrome.storage.sync.set(DEFAULTS);
  return { ...DEFAULTS };
}
