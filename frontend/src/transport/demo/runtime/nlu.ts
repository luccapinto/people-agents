/** Tiny deterministic NLU used by the fake model and the lexical router (`atrium.runtime.nlu`). */
import { type Day, addDays, day, diffDays, firstOfMonth, fromISO, lt, month, monthKey, pad2, year } from '../core/date';
import { escapeRegExp, fold } from '../core/text';

export const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'para', 'pra', 'pro', 'com', 'sem', 'e', 'ou', 'que', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'como',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'eu', 'voce', 'me', 'mim', 'se', 'ja', 'eh', 'esta', 'este', 'isso',
  'essa', 'esse', 'ao', 'aos', 'tem', 'ter', 'tenho', 'sao', 'foi', 'ser', 'estou', 'vou', 'mais', 'menos', 'muito',
  'pouco', 'sobre', 'ate', 'quando', 'onde', 'porque', 'pois', 'tambem', 'so', 'mas', 'oi', 'ola', 'bom', 'dia', 'boa',
  'tarde', 'noite', 'favor', 'obrigado', 'obrigada',
]);

const SUFFIXES = [
  'coes', 'soes', 'mente', 'ados', 'adas', 'idos', 'idas', 'ando', 'endo', 'indo', 'ado', 'ada', 'ido', 'ida',
  'oes', 'aes', 'es', 'as', 'os', 'is', 's', 'a', 'o', 'e',
];

export const WORD = /[a-z0-9]+/g;

export function stem(token: string): string {
  if (token.length <= 3 || /^\d+$/.test(token)) return token;
  for (const suf of SUFFIXES) {
    if (token.endsWith(suf) && token.length - suf.length >= 3) return token.slice(0, -suf.length);
  }
  return token;
}

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function tokens(text: string): string[] {
  return words(fold(text))
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

export function containsPhrase(foldedText: string, phrase: string): boolean {
  const p = fold(phrase);
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(p)}(?![a-z0-9])`).test(foldedText);
}

// --------------------------------------------------------------------------- dates
const DATE_FULL = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const DATE_SHORT = /\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g;
const DATE_WORDS = new RegExp(`\\b(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?`, 'g');
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function futureYear(m: number, d: number, today: Day): number {
  const candidate = day(year(today), m, Math.min(d, 28));
  return lt(candidate, addDays(today, -60)) ? year(today) + 1 : year(today);
}

function tryDay(y: number, m: number, d: number): Day | null {
  try {
    return day(y, m, d);
  } catch {
    return null;
  }
}

export function parseDates(text: string, today: Day): Day[] {
  const f = fold(text);
  const found: [number, Day][] = [];
  for (const m of f.matchAll(ISO_RE)) {
    const d = tryDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) found.push([m.index ?? 0, d]);
  }
  for (const m of f.matchAll(DATE_FULL)) {
    const d = tryDay(Number(m[3]), Number(m[2]), Number(m[1]));
    if (d) found.push([m.index ?? 0, d]);
  }
  for (const m of f.matchAll(DATE_SHORT)) {
    const at = m.index ?? 0;
    if (found.some(([pos]) => Math.abs(pos - at) < 3)) continue;
    const dayNum = Number(m[1]);
    const monthNum = Number(m[2]);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      const d = tryDay(futureYear(monthNum, dayNum, today), monthNum, dayNum);
      if (d) found.push([at, d]);
    }
  }
  for (const m of f.matchAll(DATE_WORDS)) {
    const dayNum = Number(m[1]);
    const monthNum = MONTHS.indexOf(m[2]) + 1;
    const y = m[3] ? Number(m[3]) : futureYear(monthNum, dayNum, today);
    const d = tryDay(y, monthNum, dayNum);
    if (d) found.push([m.index ?? 0, d]);
  }
  const rel: [string, number][] = [
    ['anteontem', -2],
    ['ontem', -1],
    ['hoje', 0],
    ['amanha', 1],
  ];
  for (const [word, delta] of rel) {
    const m = new RegExp(`\\b${word}\\b`).exec(f);
    if (m) found.push([m.index, addDays(today, delta)]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const out: Day[] = [];
  for (const [, d] of found) if (!out.some((x) => x.getTime() === d.getTime())) out.push(d);
  return out;
}

export function parseDays(text: string): number | null {
  const m = /\b(\d{1,2})\s*dias?\b/.exec(fold(text));
  return m ? Number(m[1]) : null;
}

export const SELL_RE = /vender\s+(\d{1,2})\s*dias?|(\d{1,2})\s*dias?\s+vendid\w*/g;

export function parseSellDays(text: string): number {
  const f = fold(text);
  const m = new RegExp(SELL_RE.source).exec(f);
  if (m) return Number(m[1] ?? m[2]);
  return /\b(vender|abono)\b/.test(f) && !f.split(' ').includes('nao') ? 10 : 0;
}

export function parseMonth(text: string, today: Day): string | null {
  const f = fold(text);
  if (f.includes('mes passado') || f.includes('ultimo holerite') || f.includes('ultimo mes')) {
    return monthKey(addDays(firstOfMonth(today), -1));
  }
  const m = /\b(\d{1,2})\/(\d{4})\b/.exec(f);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad2(Number(m[1]))}`;
  for (let i = 0; i < MONTHS.length; i += 1) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(f)) {
      const yearM = new RegExp(`${MONTHS[i]}\\s+(?:de\\s+)?(\\d{4})`).exec(f);
      const y = yearM ? Number(yearM[1]) : i + 1 <= month(today) ? year(today) : year(today) - 1;
      return `${y}-${pad2(i + 1)}`;
    }
  }
  return null;
}

export function parseAmount(text: string): number | null {
  const f = fold(text);
  let m = /(\d+(?:[.,]\d+)?)\s*mil\b/.exec(f);
  if (m) return Number(m[1].replace(',', '.')) * 1000;
  m = /r\$\s*([\d.]+(?:,\d{1,2})?)/.exec(f);
  if (m) return Number(m[1].split('.').join('').replace(',', '.'));
  return null;
}

export function parsePercent(text: string): number | null {
  const m = /(\d{1,2}(?:[.,]\d+)?)\s*%/.exec(text);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function parseYear(text: string): number | null {
  const m = /\b(20\d{2})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

const NAME_RE =
  /\b(?:do|da|de|o|a|para o|para a)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)?)/g;

const NOT_NAMES = new Set([
  'Plataforma', 'Tecnologia', 'Vitalis', 'Sorriso', 'Nimbus', 'Concierge', 'Pessoas', 'Dados', 'Engenharia',
  'Infraestrutura', 'Governança', 'Financeiro', 'Comercial', 'Operações', 'Atendimento',
]);

export function parsePerson(text: string): string | null {
  for (const m of text.matchAll(NAME_RE)) {
    const name = m[1];
    if (!NOT_NAMES.has(name.split(/\s+/)[0])) return name;
  }
  return null;
}

export function parseRequestId(text: string): string | null {
  const m = /\bFER-\d+\b/.exec(text.toUpperCase());
  return m ? m[0] : null;
}

export function parseUuid(text: string): string | null {
  const m = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.exec(text.toLowerCase());
  return m ? m[0] : null;
}

export function parseTime(text: string): string | null {
  const m = /\b(\d{1,2})(?::|h)(\d{2})?\b/.exec(fold(text));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  return h < 24 && mm < 60 ? `${pad2(h)}:${pad2(mm)}` : null;
}

export { fromISO, diffDays };
