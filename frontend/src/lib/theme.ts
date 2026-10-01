export type Theme = 'light' | 'dark';

const KEY = 'atrium.theme';

export function storedTheme(): Theme | null {
  const value = localStorage.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

export function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
