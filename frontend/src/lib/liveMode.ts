/** Live mode of the static demo: the visitor's own OpenRouter key, kept only in this tab.
 *
 *  The key lives in `sessionStorage` (gone when the tab closes, never in `localStorage`) and is
 *  sent only to OPENROUTER_URL, a constant; the demo build also restricts `connect-src` to it. */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_LIVE_MODEL = 'deepseek/deepseek-v4.1-flash';
export const LIVE_MAX_TOKENS = 700;
const KEY = 'atrium.live.key';
const MODEL = 'atrium.live.model';

export interface LiveConfig {
  key: string;
  model: string;
}

export function liveConfig(): LiveConfig | null {
  const key = sessionStorage.getItem(KEY);
  return key ? { key, model: sessionStorage.getItem(MODEL) || DEFAULT_LIVE_MODEL } : null;
}

export function enableLive(key: string, model: string): void {
  sessionStorage.setItem(KEY, key.trim());
  sessionStorage.setItem(MODEL, model.trim() || DEFAULT_LIVE_MODEL);
  window.dispatchEvent(new CustomEvent(LIVE_CHANGED_EVENT));
}

export function disableLive(): void {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(MODEL);
  window.dispatchEvent(new CustomEvent(LIVE_CHANGED_EVENT));
}

/** Fired when the key is set or removed, so the UI can show the current mode. */
export const LIVE_CHANGED_EVENT = 'atrium:live-changed';
