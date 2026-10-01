import { type MessageKey, ptBR } from './pt-BR';

const catalogs = { 'pt-BR': ptBR };
type Locale = keyof typeof catalogs;

let locale: Locale = 'pt-BR';

export function setLocale(next: Locale): void {
  locale = next;
}

/** Tiny message lookup with `{name}` interpolation. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const raw: string = catalogs[locale][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type { MessageKey };
