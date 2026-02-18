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

export async function loadSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as UserSettings;
}

export async function saveSettings(patch: Partial<UserSettings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export async function resetSettings(): Promise<UserSettings> {
  await chrome.storage.sync.set(DEFAULTS);
  return { ...DEFAULTS };
}
