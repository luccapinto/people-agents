const MONTHS_PT = [
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

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** `R$ 1.234,56` with a regular space before the number (Intl uses NBSP). */
export function money(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return currency.format(n).replace(/\u00a0/g, ' ');
}

export function number(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 2),
  }).format(value);
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${decimal.format(value)}h`;
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 1),
  }).format(value)}%`;
}

/** ISO date (`2026-10-01`) or Date to `dd/mm/aaaa`. */
export function date(value: string | Date | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return '—';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${parsed.getFullYear()}`;
}

export function dayMonth(value: string | Date | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return '—';
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-09` to `setembro de 2026`. */
export function monthLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month] = value.split('-');
  const index = Number(month) - 1;
  if (!MONTHS_PT[index]) return value;
  return `${MONTHS_PT[index]} de ${year}`;
}

export function monthName(index: number): string {
  return MONTHS_PT[index] ?? '';
}

export function dateTime(value: string | null | undefined): string {
  const parsed = toDate(value);
  if (!parsed) return '—';
  const time = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  return `${date(parsed)} ${time}`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `US$ ${value.toFixed(4).replace('.', ',')}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Parses a bare `AAAA-MM-DD` as a *local* date so calendars never shift a day by timezone.
 *  Full timestamps keep their time (and timezone) so `dateTime` shows the real hour. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isoDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}

/** Relative expiry like "4 min" used on proposal cards. */
export function untilLabel(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '—';
  const minutes = Math.round((parsed.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'instantes';
  if (minutes < 60) return `${minutes} min`;
  const hoursLeft = Math.round(minutes / 60);
  return `${hoursLeft} h`;
}
