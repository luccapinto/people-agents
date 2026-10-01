/** Annual income tax (2026) and PGBL deduction simulation (`atrium.calculators.pgbl`). */
import { type Decimal, ZERO, cents, dec, f, maxBig, minBig } from '../core/money';
import { EDUCATION_ANNUAL_LIMIT_2026, IRPF_ANNUAL_2026, type IrrfBracket } from './tables';

export const PGBL_LIMIT_RATE = dec('0.12');

function bracketFor(base: Decimal): IrrfBracket {
  for (const b of IRPF_ANNUAL_2026.brackets) if (b.upper === null || base.lte(b.upper)) return b;
  return IRPF_ANNUAL_2026.brackets[IRPF_ANNUAL_2026.brackets.length - 1];
}

function annualReduction(income: Decimal, tax: Decimal): Decimal {
  const r = IRPF_ANNUAL_2026.reduction;
  if (r === null) throw new Error('annual reduction missing');
  if (tax.lte(0)) return ZERO;
  if (income.lte(r.fullLimit)) return minBig(tax, r.fullAmount);
  if (income.lte(r.phaseOutLimit)) return maxBig(ZERO, minBig(tax, cents(r.intercept.minus(r.slope.times(income)))));
  return ZERO;
}

export interface AnnualTax {
  model: 'complete' | 'simplified';
  taxableIncome: Decimal;
  deductions: Decimal;
  base: Decimal;
  taxBeforeReduction: Decimal;
  reduction: Decimal;
  tax: Decimal;
  effectiveRate: Decimal;
}

export interface AnnualTaxOptions {
  inssPaid?: Decimal;
  dependents?: number;
  healthExpenses?: Decimal;
  educationExpenses?: Decimal;
  pgbl?: Decimal;
}

export function annualTax(taxableIncome: Decimal, model: 'complete' | 'simplified', o: AnnualTaxOptions = {}): AnnualTax {
  const income = dec(taxableIncome);
  let deductions: Decimal;
  if (model === 'simplified') {
    const rate = IRPF_ANNUAL_2026.simplifiedRate;
    const cap = IRPF_ANNUAL_2026.simplifiedDiscount;
    if (!rate || !cap) throw new Error('simplified table missing');
    deductions = minBig(cents(income.times(rate)), cap);
  } else if (model === 'complete') {
    const pgblCap = cents(income.times(PGBL_LIMIT_RATE));
    const dependents = o.dependents ?? 0;
    deductions = dec(o.inssPaid ?? ZERO)
      .plus(IRPF_ANNUAL_2026.dependentDeduction.times(dependents))
      .plus(dec(o.healthExpenses ?? ZERO))
      .plus(minBig(dec(o.educationExpenses ?? ZERO), EDUCATION_ANNUAL_LIMIT_2026.times(1 + dependents)))
      .plus(minBig(dec(o.pgbl ?? ZERO), pgblCap));
  } else {
    throw new Error(String(model));
  }
  const base = maxBig(ZERO, income.minus(deductions));
  const b = bracketFor(base);
  const tax = maxBig(ZERO, cents(base.times(b.rate).minus(b.deduction)));
  const reduction = annualReduction(income, tax);
  const final = cents(tax.minus(reduction));
  const rate = income.eq(0) ? ZERO : final.div(income).round(4, 1);
  return {
    model,
    taxableIncome: cents(income),
    deductions: cents(deductions),
    base: cents(base),
    taxBeforeReduction: tax,
    reduction,
    tax: final,
    effectiveRate: rate,
  };
}

export interface PgblScenario {
  percent: number;
  contribution: number;
  tax: number;
  saving: number;
}

export interface PgblSimulation {
  eligible: boolean;
  reasons: string[];
  taxableIncome: Decimal;
  limit: Decimal;
  contribution: Decimal;
  monthlyContribution: Decimal;
  bestWithoutPgbl: AnnualTax;
  completeWithPgbl: AnnualTax;
  taxSaving: Decimal;
  savingRate: Decimal;
  recommendation: string;
  scenarios: PgblScenario[];
}

export function pgblSimulation(
  taxableIncome: Decimal,
  inssPaid: Decimal,
  dependents: number,
  healthExpenses: Decimal,
  educationExpenses: Decimal = ZERO,
  contribution: Decimal | null = null,
  contributesToOfficialRegime = true,
): PgblSimulation {
  const income = dec(taxableIncome);
  const limit = cents(income.times(PGBL_LIMIT_RATE));
  const reasons: string[] = [];
  if (!contributesToOfficialRegime) {
    reasons.push('A dedução exige contribuição para o regime oficial de previdência (INSS).');
  }
  const common: AnnualTaxOptions = { inssPaid, dependents, healthExpenses, educationExpenses };
  const simplified = annualTax(income, 'simplified');
  const complete0 = annualTax(income, 'complete', common);
  const best0 = simplified.tax.lte(complete0.tax) ? simplified : complete0;
  const amount = contribution === null ? limit : minBig(dec(contribution), limit);
  const withPgbl = annualTax(income, 'complete', { ...common, pgbl: amount });
  const eligible = reasons.length === 0;
  const saving = eligible ? maxBig(ZERO, cents(best0.tax.minus(withPgbl.tax))) : ZERO;
  let rec: string;
  if (!eligible) {
    rec = 'Sem direito à dedução do PGBL nas condições informadas.';
  } else if (saving.lte(0)) {
    rec =
      'O PGBL não reduz seu imposto: com a isenção/redução vigente, seu IR anual estimado já é zero ou o modelo simplificado é melhor.';
  } else {
    rec = 'Contribuir até o limite de 12% e declarar no modelo completo reduz o IR anual estimado.';
  }
  const scenarios: PgblScenario[] = [];
  for (const pct of [dec('0'), dec('0.04'), dec('0.08'), dec('0.12')]) {
    const c = cents(income.times(pct));
    const t = annualTax(income, 'complete', { ...common, pgbl: c });
    const bestTax = pct.eq(0) ? minBig(t.tax, simplified.tax) : t.tax;
    scenarios.push({
      percent: f(pct.times(100)),
      contribution: f(c),
      tax: f(bestTax),
      saving: eligible ? f(maxBig(ZERO, cents(best0.tax.minus(bestTax)))) : 0,
    });
  }
  return {
    eligible,
    reasons,
    taxableIncome: cents(income),
    limit,
    contribution: amount,
    monthlyContribution: cents(amount.div(12)),
    bestWithoutPgbl: best0,
    completeWithPgbl: withPgbl,
    taxSaving: saving,
    savingRate: amount.eq(0) ? ZERO : saving.div(amount).round(4, 1),
    recommendation: rec,
    scenarios,
  };
}
