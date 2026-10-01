/** Holiday calendar for the company's sites (port of `atrium.calculators.holidays`). */
import { addDays, cmp, type Day, day, month, toISO, weekday, year } from '../core/date';

export interface Holiday {
  date: Day;
  name: string;
  scope: 'national' | 'state' | 'municipal' | 'company';
}

export interface HolidayDict {
  date: string;
  name: string;
  scope: string;
}

export function holidayDict(h: Holiday): HolidayDict {
  return { date: toISO(h.date), name: h.name, scope: h.scope };
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easter(y: number): Day {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const total = h + l - 7 * m + 114;
  return day(y, Math.floor(total / 31), (total % 31) + 1);
}

export const SITES: Record<string, { label: string; state: string; city: string }> = {
  'SP-SAO_PAULO': { label: 'São Paulo, SP', state: 'SP', city: 'São Paulo' },
};

const cache = new Map<string, Holiday[]>();

export function holidays(y: number, site = 'SP-SAO_PAULO'): Holiday[] {
  if (!(site in SITES)) throw new Error(`unknown site ${site}`);
  const key = `${y}|${site}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const e = easter(y);
  const items: Holiday[] = [
    { date: day(y, 1, 1), name: 'Confraternização Universal', scope: 'national' },
    { date: addDays(e, -48), name: 'Carnaval (segunda-feira)', scope: 'company' },
    { date: addDays(e, -47), name: 'Carnaval (terça-feira)', scope: 'company' },
    { date: addDays(e, -2), name: 'Sexta-feira Santa', scope: 'national' },
    { date: day(y, 4, 21), name: 'Tiradentes', scope: 'national' },
    { date: day(y, 5, 1), name: 'Dia do Trabalho', scope: 'national' },
    { date: day(y, 9, 7), name: 'Independência do Brasil', scope: 'national' },
    { date: day(y, 10, 12), name: 'Nossa Senhora Aparecida', scope: 'national' },
    { date: day(y, 11, 2), name: 'Finados', scope: 'national' },
    { date: day(y, 11, 15), name: 'Proclamação da República', scope: 'national' },
    { date: day(y, 11, 20), name: 'Dia Nacional de Zumbi e da Consciência Negra', scope: 'national' },
    { date: day(y, 12, 25), name: 'Natal', scope: 'national' },
    { date: day(y, 7, 9), name: 'Revolução Constitucionalista', scope: 'state' },
    { date: day(y, 1, 25), name: 'Aniversário de São Paulo', scope: 'municipal' },
    { date: addDays(e, 60), name: 'Corpus Christi', scope: 'municipal' },
  ];
  items.sort((a, b) => cmp(a.date, b.date));
  cache.set(key, items);
  return items;
}

/** Holidays keyed by ISO date — the equivalent of Python's `dict[date, Holiday]`. */
export type HolidayMap = Map<string, Holiday>;

export function holidayMap(years: number[], site = 'SP-SAO_PAULO'): HolidayMap {
  const out: HolidayMap = new Map();
  for (const y of years) for (const h of holidays(y, site)) out.set(toISO(h.date), h);
  return out;
}

export function isWeekend(d: Day): boolean {
  return weekday(d) >= 5;
}

export function isNonWorking(d: Day, hmap: HolidayMap): boolean {
  return isWeekend(d) || hmap.has(toISO(d));
}

/** (business days, rest days) of a month — used for the DSR reflex on overtime. */
export function businessDays(y: number, m: number, site = 'SP-SAO_PAULO'): [number, number] {
  const hmap = holidayMap([y], site);
  let d = day(y, m, 1);
  let work = 0;
  let rest = 0;
  while (month(d) === m) {
    if (isNonWorking(d, hmap)) rest += 1;
    else work += 1;
    d = addDays(d, 1);
  }
  return [work, rest];
}

/** `atrium.seed.company._dsr_ratio`: rest days (Sundays + holidays) over useful days. */
export function dsrRatio(y: number, m: number, hmap: HolidayMap): string {
  let d = day(y, m, 1);
  let rest = 0;
  let useful = 0;
  while (month(d) === m) {
    if (weekday(d) === 6 || hmap.has(toISO(d))) rest += 1;
    else useful += 1;
    d = addDays(d, 1);
  }
  return `${rest}/${useful}`;
}

export function yearsAround(today: Day): number[] {
  const y = year(today);
  return [y - 1, y, y + 1, y + 2];
}
