/** Every vector of `shared/fixtures/calculators.json` must match the TypeScript port. */
import { describe, expect, it } from 'vitest';
import fixtures from '../../../../../shared/fixtures/calculators.json';
import { annualTax } from '../calc/pgbl';
import { bestWindows } from '../calc/vacation';
import { easter } from '../calc/holidays';
import { inss, irrfMonthly, plrTax } from '../calc/payroll';
import { fromISO, toISO } from '../core/date';
import { dec, f } from '../core/money';
import { hmapFor } from '../tools/util';

describe('INSS', () => {
  for (const v of fixtures.inss) {
    it(v.ref, () => {
      expect(f(inss(dec(String(v.base)), fromISO(v.date)).amount)).toBe(v.amount);
    });
  }
});

describe('IRRF mensal', () => {
  for (const v of fixtures.irrf_monthly) {
    it(v.ref, () => {
      const r = irrfMonthly(dec(String(v.gross)), dec(String(v.inss)), v.dependents, fromISO(v.date));
      expect(f(r.base)).toBe(v.base);
      expect(r.deductionMode).toBe(v.mode);
      expect(f(r.taxBeforeReduction)).toBe(v.tax_before_reduction);
      expect(f(r.reduction)).toBe(v.reduction);
      expect(f(r.tax)).toBe(v.tax);
    });
  }
});

describe('PLR', () => {
  for (const v of fixtures.plr) {
    it(v.ref, () => {
      expect(f(plrTax(dec(String(v.amount))))).toBe(v.tax);
    });
  }
});

describe('IR anual', () => {
  for (const v of fixtures.annual_tax) {
    it(v.ref, () => {
      const r = annualTax(dec(String(v.income)), v.model as 'complete' | 'simplified', {
        inssPaid: dec(String(v.inss)),
        dependents: v.dependents,
        healthExpenses: dec(String(v.health)),
        pgbl: dec(String(v.pgbl)),
      });
      expect(f(r.tax)).toBe(v.tax);
    });
  }
});

describe('Páscoa', () => {
  for (const v of fixtures.easter) {
    it(String(v.year), () => {
      expect(toISO(easter(v.year))).toBe(v.date);
    });
  }
});

describe('Janela de férias', () => {
  const v = fixtures.vacation_best_5_day;
  it(v.ref, () => {
    const hmap = hmapFor(fromISO('2026-10-01'));
    const windows = bestWindows([5], hmap, fromISO(v.earliest), fromISO(v.latest_end), [], 1);
    expect(toISO(windows[0].start)).toBe(v.start);
    expect(windows[0].restDays).toBe(v.rest_days);
  });
});
