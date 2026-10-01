/** Detection and masking of personal identifiers (Brazilian formats). */

export const CPF_RE = /(?<!\d)(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d)/g;
export const CNPJ_RE = /(?<!\d)(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})(?!\d)/g;
export const CARD_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
export const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
export const PHONE_RE = /(?<![\d,.])\(?\b\d{2}\)?[ ]?9?\d{4}-\d{4}\b/g;
export const ACCOUNT_RE =
  /\b(?:ag(?:[eê]ncia)?\.?\s*\d{3,5}[\s,;/-]*)?c(?:onta)?\s*(?:c(?:orrente)?\.?|\/c)?\s*:?\s*\d{4,12}-?[\dxX]\b/gi;

function digits(value: string): number[] {
  return [...value].filter((c) => c >= '0' && c <= '9').map(Number);
}

export function validCpf(value: string): boolean {
  const d = digits(value);
  if (d.length !== 11 || new Set(d).size === 1) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += d[i] * (n + 1 - i);
    if ((((s * 10) % 11) % 10) !== d[n]) return false;
  }
  return true;
}

export function validCnpj(value: string): boolean {
  const d = digits(value);
  if (d.length !== 14 || new Set(d).size === 1) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, ...w1];
  for (const [weights, pos] of [
    [w1, 12],
    [w2, 13],
  ] as [number[], number][]) {
    let s = 0;
    for (let i = 0; i < pos; i += 1) s += d[i] * weights[i];
    const r = s % 11;
    if ((r < 2 ? 0 : 11 - r) !== d[pos]) return false;
  }
  return true;
}

export function luhn(value: string): boolean {
  const d = digits(value);
  if (d.length < 13 || d.length > 19) return false;
  let total = 0;
  const reversed = [...d].reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    let n = reversed[i];
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return total % 10 === 0;
}

export interface PiiFinding {
  kind: string;
  count: number;
}

export function maskPii(text: string): [string, PiiFinding[]] {
  const counts = new Map<string, number>();
  let current = text;
  const sub = (kind: string, label: string, regex: RegExp, validator?: (value: string) => boolean): void => {
    const rx = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    current = current.replace(rx, (match) => {
      if (validator && !validator(match)) return match;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return label;
    });
  };
  sub('cnpj', '[CNPJ]', CNPJ_RE, validCnpj);
  sub('cpf', '[CPF]', CPF_RE, validCpf);
  sub('card', '[CARTÃO]', CARD_RE, luhn);
  sub('email', '[EMAIL]', EMAIL_RE);
  sub('bank_account', '[CONTA]', ACCOUNT_RE);
  sub('phone', '[TELEFONE]', PHONE_RE);
  return [current, [...counts].map(([kind, count]) => ({ kind, count }))];
}

export function findPii(text: string): PiiFinding[] {
  return maskPii(text)[1];
}

/** Recursively mask strings inside objects/arrays (audit payloads, stored traces). */
export function maskStructure<T>(value: T): T {
  if (typeof value === 'string') return maskPii(value)[0] as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskStructure(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskStructure(v);
    return out as unknown as T;
  }
  return value;
}
