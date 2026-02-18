export interface UserSettings {
  concurrency: number; // 1–16
  convertToMp4: boolean; // output format preference
}

const DEFAULTS: UserSettings = { concurrency: 6, convertToMp4: false };

export async function loadSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as UserSettings;
}

export async function saveSettings(patch: Partial<UserSettings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
