import { describe, expect, it } from 'vitest';
import { date, dateTime, dayMonth, hours, money, monthLabel, untilLabel, usd } from './format';

describe('money', () => {
  it('formats reais with a thousands dot and a decimal comma', () => {
    expect(money(1234.56)).toBe('R$ 1.234,56');
    expect(money(0)).toBe('R$ 0,00');
    expect(money(-89.9)).toBe('-R$ 89,90');
  });

  it('accepts numeric strings and rejects missing values', () => {
    expect(money('2500')).toBe('R$ 2.500,00');
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
});

describe('date', () => {
  it('formats ISO days as dd/mm/aaaa without timezone drift', () => {
    expect(date('2026-01-05')).toBe('05/01/2026');
    expect(date('2026-12-31')).toBe('31/12/2026');
    expect(dayMonth('2026-11-23')).toBe('23/11');
  });

  it('keeps the same calendar day for ISO timestamps', () => {
    expect(date('2026-10-01T23:30:00')).toBe('01/10/2026');
  });

  it('keeps the time of day for full timestamps', () => {
    expect(dateTime('2026-10-01T14:05:00')).toBe('01/10/2026 14:05');
  });

  it('labels months in Portuguese', () => {
    expect(monthLabel('2026-09')).toBe('setembro de 2026');
  });
});

describe('other formatters', () => {
  it('formats hours and dollars with four decimals', () => {
    expect(hours(12.5)).toBe('12,5h');
    expect(usd(0.0123456)).toBe('US$ 0,0123');
  });

  it('describes a near-future expiry in minutes', () => {
    expect(untilLabel(new Date(Date.now() + 9 * 60000).toISOString())).toBe('9 min');
    expect(untilLabel(new Date(Date.now() - 60000).toISOString())).toBe('instantes');
  });
});
