/** Helpers shared by tool implementations (`atrium.tools._util`). */
import { type Day, addDays, fmtDate, fmtDayMonth, year } from '../core/date';
import { type Decimal, ZERO, brl, dec } from '../core/money';
import { type HolidayMap, holidayMap, isNonWorking } from '../calc/holidays';
import type { DependentRow, SalaryEntry } from '../data/store';

export const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
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

export const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

export const d = fmtDate;
export const dm = fmtDayMonth;

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} de ${y}`;
}

export function money(value: Decimal | number | string): string {
  return brl(dec(typeof value === 'number' ? String(value) : value));
}

/** `13.94 -> "13,9%"` */
export function pct(value: Decimal | number): string {
  const n = typeof value === 'number' ? value : Number(value.toString());
  return `${n.toFixed(1)}%`.replace('.', ',');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hmapFor(today: Day): HolidayMap {
  const y = year(today);
  return holidayMap([y - 1, y, y + 1, y + 2]);
}

export function nextWorkingDay(start: Day, hmap: HolidayMap): Day {
  let out = addDays(start, 1);
  while (isNonWorking(out, hmap)) out = addDays(out, 1);
  return out;
}

export function currentSalary(history: SalaryEntry[]): Decimal {
  return history.length ? dec(String(history[history.length - 1].salary)) : ZERO;
}

export function irDependents(dependents: DependentRow[]): number {
  return dependents.filter((x) => x.ir_dependent && x.status === 'active').length;
}

export function maskAccount(account: string): string {
  const digits = account.split('-').join('');
  return digits.length >= 4 ? `****${digits.slice(-4, -1)}-${digits.slice(-1)}` : '****';
}

/** `f"{v:g}h"` with the Brazilian decimal comma, used by the time tools. */
export function hours(value: number): string {
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
  return `${text}h`.replace('.', ',');
}
