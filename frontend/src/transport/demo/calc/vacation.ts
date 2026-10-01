/** Vacation rules (CLT) and the rest-maximizing window optimizer.
 *  Port of `atrium.calculators.vacation`; all ordering uses integer keys so results match. */
import {
  addDays,
  type Day,
  diffDays,
  fmtDate,
  fmtDayMonth,
  gt,
  gte,
  lt,
  lte,
  ordinal,
  replaceYear,
  toISO,
  weekday,
} from '../core/date';
import { type HolidayMap, isNonWorking } from './holidays';

export const MIN_FRACTION = 5;
export const MAIN_FRACTION = 14;
export const MAX_FRACTIONS = 3;
export const NOTICE_DAYS = 30;

export function entitlementForAbsences(unjustifiedAbsences: number): number {
  if (unjustifiedAbsences <= 5) return 30;
  if (unjustifiedAbsences <= 14) return 24;
  if (unjustifiedAbsences <= 23) return 18;
  if (unjustifiedAbsences <= 32) return 12;
  return 0;
}

/** Last day of the concession period: 12 months after the acquisition period ends. */
export function concessionEnd(acquisitionEnd: Day): Day {
  return replaceYear(acquisitionEnd, acquisitionEnd.getUTCFullYear() + 1);
}

export interface Fraction {
  start: Day;
  days: number;
}

export function fractionEnd(fr: Fraction): Day {
  return addDays(fr.start, fr.days - 1);
}

export class PeriodState {
  constructor(
    readonly acquisitionStart: Day,
    readonly acquisitionEnd: Day,
    readonly entitledDays: number,
    readonly fractions: Fraction[] = [],
    readonly soldDays = 0,
  ) {}

  get usedDays(): number {
    return this.fractions.reduce((sum, fr) => sum + fr.days, 0) + this.soldDays;
  }

  get balance(): number {
    return Math.max(0, this.entitledDays - this.usedDays);
  }

  get hasMainFraction(): boolean {
    return this.fractions.some((fr) => fr.days >= MAIN_FRACTION);
  }

  get deadline(): Day {
    return concessionEnd(this.acquisitionEnd);
  }
}

export interface Issue {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function startIssues(start: Day, hmap: HolidayMap): Issue[] {
  const issues: Issue[] = [];
  if (isNonWorking(start, hmap)) {
    issues.push({ code: 'start_non_working', message: 'As férias devem começar em um dia útil.', severity: 'error' });
  }
  for (const offset of [1, 2]) {
    const d = addDays(start, offset);
    const holiday = hmap.get(toISO(d));
    if (holiday) {
      issues.push({
        code: 'start_before_holiday',
        message: `Não é permitido iniciar férias nos 2 dias que antecedem feriado (${holiday.name}, ${fmtDayMonth(d)}) — CLT art. 134 §3º.`,
        severity: 'error',
      });
      break;
    }
    if (weekday(d) === 6) {
      issues.push({
        code: 'start_before_rest',
        message:
          'Não é permitido iniciar férias nos 2 dias que antecedem o repouso semanal (domingo) — CLT art. 134 §3º.',
        severity: 'error',
      });
      break;
    }
  }
  return issues;
}

export function isValidStart(start: Day, hmap: HolidayMap): boolean {
  return startIssues(start, hmap).length === 0;
}

/** Balance and splitting rules (CLT art. 134 §1, art. 143) for a vacation of `days`, whatever
 *  the start date. Shared by the request validation and the window suggestions. */
export function fractionIssues(period: PeriodState, days: number, sellDays = 0): Issue[] {
  const issues: Issue[] = [];
  const balance = period.balance;
  if (days < MIN_FRACTION) {
    issues.push({
      code: 'min_5',
      message: 'Cada período de férias deve ter pelo menos 5 dias corridos (CLT art. 134 §1º).',
      severity: 'error',
    });
  }
  if (sellDays < 0 || sellDays > Math.floor(period.entitledDays / 3)) {
    issues.push({
      code: 'abono_max_third',
      message: `O abono pecuniário é limitado a 1/3 do direito (${Math.floor(period.entitledDays / 3)} dias) — CLT art. 143.`,
      severity: 'error',
    });
  }
  if (days + sellDays > balance) {
    issues.push({
      code: 'insufficient_balance',
      message: `Saldo insuficiente: você tem ${balance} dias disponíveis neste período.`,
      severity: 'error',
    });
  }
  if (period.fractions.length + 1 > MAX_FRACTIONS) {
    issues.push({
      code: 'max_3_fractions',
      message: 'As férias podem ser divididas em no máximo 3 períodos (CLT art. 134 §1º).',
      severity: 'error',
    });
  }
  const remaining = balance - days - sellDays;
  if (!period.hasMainFraction && days < MAIN_FRACTION && remaining < MAIN_FRACTION) {
    issues.push({
      code: 'needs_14_day_fraction',
      message:
        'Um dos períodos precisa ter pelo menos 14 dias corridos; com esta divisão isso deixaria de ser possível (CLT art. 134 §1º).',
      severity: 'error',
    });
  }
  if (remaining > 0 && remaining < MIN_FRACTION) {
    issues.push({
      code: 'remainder_below_5',
      message: `Sobrariam ${remaining} dias, menos que o mínimo de 5 para um novo período.`,
      severity: 'error',
    });
  }
  if (period.fractions.length + 1 === MAX_FRACTIONS && remaining > 0) {
    issues.push({
      code: 'remainder_without_fraction',
      message: 'Este seria o 3º período, mas ainda sobraria saldo sem período disponível.',
      severity: 'error',
    });
  }
  return issues;
}

export function validateRequest(
  period: PeriodState,
  start: Day,
  days: number,
  sellDays: number,
  hmap: HolidayMap,
  today: Day,
): Issue[] {
  const issues = fractionIssues(period, days, sellDays);
  issues.push(...startIssues(start, hmap));
  if (diffDays(start, today) < NOTICE_DAYS) {
    issues.push({
      code: 'notice_30_days',
      message: 'A solicitação precisa de antecedência mínima de 30 dias (CLT art. 135 e política interna).',
      severity: 'error',
    });
  }
  const newEnd = addDays(start, days - 1);
  for (const fr of period.fractions) {
    if (lte(start, fractionEnd(fr)) && lte(fr.start, newEnd)) {
      issues.push({
        code: 'overlap',
        message: `Conflita com férias já registradas a partir de ${fmtDate(fr.start)}.`,
        severity: 'error',
      });
    }
  }
  const late = diffDays(newEnd, period.deadline);
  if (late > 0) {
    issues.push({
      code: 'double_pay',
      message: `${Math.min(late, days)} dia(s) cairiam após o fim do período concessivo (${fmtDate(period.deadline)}) e seriam pagos em dobro (CLT art. 137).`,
      severity: 'warning',
    });
  }
  if (sellDays && gt(today, addDays(period.acquisitionEnd, -15))) {
    issues.push({
      code: 'abono_late',
      message:
        'O prazo legal para pedir o abono (15 dias antes do fim do período aquisitivo) passou; depende de concordância da empresa (CLT art. 143 §1º).',
      severity: 'warning',
    });
  }
  return issues;
}

// --------------------------------------------------------------------------- optimizer
export interface Window {
  start: Day;
  days: number;
  restStart: Day;
  restEnd: Day;
  restDays: number;
  holidaysBridged: string[];
  holidaysInside: string[];
}

export function windowEnd(w: Window): Day {
  return addDays(w.start, w.days - 1);
}

export function bonusDays(w: Window): number {
  return w.restDays - w.days;
}

export function efficiencyX1000(w: Window): number {
  return Math.floor((w.restDays * 1000) / w.days);
}

export interface WindowDict {
  start: string;
  end: string;
  days: number;
  rest_start: string;
  rest_end: string;
  rest_days: number;
  bonus_days: number;
  efficiency: number;
  holidays_bridged: string[];
  holidays_inside: string[];
}

export function windowDict(w: Window): WindowDict {
  return {
    start: toISO(w.start),
    end: toISO(windowEnd(w)),
    days: w.days,
    rest_start: toISO(w.restStart),
    rest_end: toISO(w.restEnd),
    rest_days: w.restDays,
    bonus_days: bonusDays(w),
    efficiency: Math.round((efficiencyX1000(w) / 1000) * 1000) / 1000,
    holidays_bridged: [...w.holidaysBridged],
    holidays_inside: [...w.holidaysInside],
  };
}

export function windowAt(start: Day, days: number, hmap: HolidayMap): Window {
  const end = addDays(start, days - 1);
  let restStart = start;
  const bridged: string[] = [];
  let d = addDays(start, -1);
  while (isNonWorking(d, hmap)) {
    const h = hmap.get(toISO(d));
    if (h) bridged.push(h.name);
    restStart = d;
    d = addDays(d, -1);
  }
  let restEnd = end;
  d = addDays(end, 1);
  while (isNonWorking(d, hmap)) {
    const h = hmap.get(toISO(d));
    if (h) bridged.push(h.name);
    restEnd = d;
    d = addDays(d, 1);
  }
  const inside: string[] = [];
  d = start;
  while (lte(d, end)) {
    const h = hmap.get(toISO(d));
    if (h && weekday(d) < 5) inside.push(h.name);
    d = addDays(d, 1);
  }
  return {
    start,
    days,
    restStart,
    restEnd,
    restDays: diffDays(restEnd, restStart) + 1,
    holidaysBridged: bridged,
    holidaysInside: inside,
  };
}

function sortKey(w: Window): [number, number, number] {
  return [-efficiencyX1000(w), -w.restDays, ordinal(w.start)];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function overlaps(aStart: Day, aEnd: Day, bStart: Day, bEnd: Day): boolean {
  return lte(aStart, bEnd) && lte(bStart, aEnd);
}

export function candidateWindows(
  days: number,
  hmap: HolidayMap,
  earliest: Day,
  latestEnd: Day,
  blocked: Fraction[] = [],
): Window[] {
  const out: Window[] = [];
  let start = earliest;
  while (lte(addDays(start, days - 1), latestEnd)) {
    if (isValidStart(start, hmap)) {
      const end = addDays(start, days - 1);
      if (!blocked.some((b) => overlaps(start, end, b.start, fractionEnd(b)))) out.push(windowAt(start, days, hmap));
    }
    start = addDays(start, 1);
  }
  out.sort((a, b) => compareKeys(sortKey(a), sortKey(b)));
  return out;
}

/** Top windows across the given lengths whose rest blocks do not overlap each other; with
 *  `latestStart`, only windows starting by then compete (a month asked for on its own). */
export function bestWindows(
  lengths: number[],
  hmap: HolidayMap,
  earliest: Day,
  latestEnd: Day,
  blocked: Fraction[] = [],
  top = 5,
  latestStart: Day | null = null,
): Window[] {
  const pool: Window[] = [];
  for (const n of lengths) {
    for (const w of candidateWindows(n, hmap, earliest, latestEnd, blocked)) {
      if (latestStart === null || lte(w.start, latestStart)) pool.push(w);
    }
  }
  pool.sort((a, b) => compareKeys(sortKey(a), sortKey(b)));
  const chosen: Window[] = [];
  for (const w of pool) {
    if (chosen.some((c) => overlaps(w.restStart, w.restEnd, c.restStart, c.restEnd))) continue;
    chosen.push(w);
    if (chosen.length === top) break;
  }
  return chosen;
}

/** Ways to split `balance` into at most `slots` fractions obeying CLT art. 134 §1. */
export function partitions(balance: number, slots: number, needsMain: boolean): number[][] {
  const result: number[][] = [];
  const rec = (remaining: number, maxPart: number, parts: number[]): void => {
    if (remaining === 0) {
      if (!needsMain || parts.some((p) => p >= MAIN_FRACTION)) result.push([...parts]);
      return;
    }
    if (parts.length === slots) return;
    for (let p = Math.min(maxPart, remaining); p >= MIN_FRACTION; p -= 1) {
      parts.push(p);
      rec(remaining - p, p, parts);
      parts.pop();
    }
  };
  rec(balance, balance, []);
  return result;
}

export interface Plan {
  windows: Window[];
}

export function planRestDays(p: Plan): number {
  return p.windows.reduce((sum, w) => sum + w.restDays, 0);
}

export function planUsedDays(p: Plan): number {
  return p.windows.reduce((sum, w) => sum + w.days, 0);
}

export interface PlanDict {
  fractions: WindowDict[];
  used_days: number;
  rest_days: number;
  bonus_days: number;
}

export function planDict(p: Plan): PlanDict {
  const sorted = [...p.windows].sort((a, b) => ordinal(a.start) - ordinal(b.start));
  return {
    fractions: sorted.map(windowDict),
    used_days: planUsedDays(p),
    rest_days: planRestDays(p),
    bonus_days: planRestDays(p) - planUsedDays(p),
  };
}

function planKey(p: Plan): [number, number, number] {
  const first = Math.min(...p.windows.map((w) => ordinal(w.start)));
  return [-planRestDays(p), p.windows.length, first];
}

function planSignature(p: Plan): string {
  return [...p.windows]
    .map((w) => [ordinal(w.start), w.days] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((pair) => pair.join(':'))
    .join('|');
}

/** Exhaustive search over one window per fraction whose rest blocks do not overlap. */
function bestCombination(options: Window[][]): Plan | null {
  let best: Plan | null = null;
  const rec = (i: number, picked: Window[]): void => {
    if (i === options.length) {
      const plan: Plan = { windows: [...picked] };
      if (best === null || compareKeys(planKey(plan), planKey(best)) < 0) best = plan;
      return;
    }
    for (const w of options[i]) {
      if (picked.some((p) => overlaps(w.restStart, w.restEnd, p.restStart, p.restEnd))) continue;
      picked.push(w);
      rec(i + 1, picked);
      picked.pop();
    }
  };
  rec(0, []);
  return best;
}

/** Best ways to use the whole balance of a period, maximizing total consecutive rest. */
export function planBalance(
  period: PeriodState,
  hmap: HolidayMap,
  earliest: Day,
  latestEnd: Day,
  top = 3,
  perLength = 10,
): Plan[] {
  const balance = period.balance;
  const slots = MAX_FRACTIONS - period.fractions.length;
  if (balance < MIN_FRACTION || slots <= 0) return [];
  const partsList = partitions(balance, slots, !period.hasMainFraction);
  const cache = new Map<number, Window[]>();
  const plans: Plan[] = [];
  for (const parts of partsList) {
    const options: Window[][] = [];
    for (const n of parts) {
      let windows = cache.get(n);
      if (!windows) {
        windows = bestWindows([n], hmap, earliest, latestEnd, period.fractions, perLength);
        cache.set(n, windows);
      }
      options.push(windows);
    }
    const best = bestCombination(options);
    if (best !== null) plans.push(best);
  }
  plans.sort((a, b) => compareKeys(planKey(a), planKey(b)));
  const unique: Plan[] = [];
  for (const p of plans) {
    if (unique.every((u) => planSignature(p) !== planSignature(u))) unique.push(p);
    if (unique.length === top) break;
  }
  return unique;
}

export { gte, lt, gt, lte };
