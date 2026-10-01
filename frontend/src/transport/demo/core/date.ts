/** Calendar-day arithmetic that mirrors Python's `datetime.date` exactly.
 *  A day is a UTC-midnight `Date`; every helper stays in UTC so DST never shifts a day. */

export type Day = Date;

export function day(year: number, month: number, dayOfMonth: number): Day {
  const d = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== dayOfMonth) {
    throw new RangeError(`invalid date ${year}-${month}-${dayOfMonth}`);
  }
  return d;
}

/** Parse `AAAA-MM-DD` (extra time components are ignored, like `date.fromisoformat`). */
export function fromISO(value: string): Day {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new RangeError(`invalid isoformat ${value}`);
  return day(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function toISO(d: Day): string {
  return d.toISOString().slice(0, 10);
}

export function year(d: Day): number {
  return d.getUTCFullYear();
}

export function month(d: Day): number {
  return d.getUTCMonth() + 1;
}

export function dayOf(d: Day): number {
  return d.getUTCDate();
}

/** Monday = 0 … Sunday = 6, like `date.weekday()`. */
export function weekday(d: Day): number {
  return (d.getUTCDay() + 6) % 7;
}

const MS_DAY = 86_400_000;

export function addDays(d: Day, n: number): Day {
  return new Date(d.getTime() + n * MS_DAY);
}

export function diffDays(a: Day, b: Day): number {
  return Math.round((a.getTime() - b.getTime()) / MS_DAY);
}

export function ordinal(d: Day): number {
  return Math.round(d.getTime() / MS_DAY);
}

export function cmp(a: Day, b: Day): number {
  return a.getTime() - b.getTime();
}

export function eq(a: Day, b: Day): boolean {
  return a.getTime() === b.getTime();
}

export function lte(a: Day, b: Day): boolean {
  return a.getTime() <= b.getTime();
}

export function lt(a: Day, b: Day): boolean {
  return a.getTime() < b.getTime();
}

export function gt(a: Day, b: Day): boolean {
  return a.getTime() > b.getTime();
}

export function gte(a: Day, b: Day): boolean {
  return a.getTime() >= b.getTime();
}

export function minDay(days: Day[]): Day {
  return days.reduce((best, d) => (d.getTime() < best.getTime() ? d : best));
}

export function maxDay(days: Day[]): Day {
  return days.reduce((best, d) => (d.getTime() > best.getTime() ? d : best));
}

/** `d.replace(year=…)`, falling back to the 28th for 29 February (CLT anniversaries). */
export function replaceYear(d: Day, newYear: number): Day {
  try {
    return day(newYear, month(d), dayOf(d));
  } catch {
    return day(newYear, month(d), 28);
  }
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `%d/%m/%Y` */
export function fmtDate(d: Day): string {
  return `${pad2(dayOf(d))}/${pad2(month(d))}/${year(d)}`;
}

/** `%d/%m` */
export function fmtDayMonth(d: Day): string {
  return `${pad2(dayOf(d))}/${pad2(month(d))}`;
}

/** `AAAA-MM` competence key. */
export function monthKey(d: Day): string {
  return `${year(d)}-${pad2(month(d))}`;
}

export function firstOfMonth(d: Day): Day {
  return day(year(d), month(d), 1);
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function yearRange(from: number, toExclusive: number): number[] {
  const out: number[] = [];
  for (let y = from; y < toExclusive; y += 1) out.push(y);
  return out;
}
