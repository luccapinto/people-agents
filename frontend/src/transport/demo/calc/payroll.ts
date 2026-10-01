/** Payroll calculators: INSS, IRRF, 13th salary, vacation pay, payslip and PLR.
 *  Port of `atrium.calculators.payroll`; all rounding is half-up to cents. */
import type { Day } from '../core/date';
import { type Decimal, ZERO, cents, dec, f, gfmt, maxBig, minBig } from '../core/money';
import { type IrrfBracket, type IrrfTable, PLR_TABLE, inssTable, irrfMonthlyTable } from './tables';

export const HOURS_DIVISOR = dec('200');
export const OVERTIME_RATE = dec('1.5');
export const VT_RATE = dec('0.06');
export const FGTS_RATE = dec('0.08');

export interface InssBracketRow {
  from: number;
  to: number;
  rate: number;
  value: number;
}

export interface InssResult {
  base: Decimal;
  amount: Decimal;
  ceilingApplied: boolean;
  brackets: InssBracketRow[];
}

/** Progressive employee INSS contribution (each bracket taxed at its own rate). */
export function inss(base: Decimal, on: Day): InssResult {
  const value = dec(base);
  const table = inssTable(on);
  const ceiling = table.brackets[table.brackets.length - 1][0];
  const capped = minBig(value, ceiling);
  let lower = ZERO;
  let total = ZERO;
  const parts: InssBracketRow[] = [];
  for (const [upper, rate] of table.brackets) {
    if (capped.lte(lower)) break;
    const portion = minBig(capped, upper).minus(lower);
    const amount = portion.times(rate);
    total = total.plus(amount);
    parts.push({ from: f(lower), to: f(upper), rate: f(rate), value: Number(cents(amount).toString()) });
    lower = upper;
  }
  return { base: value, amount: cents(total), ceilingApplied: value.gt(ceiling), brackets: parts };
}

export interface IrrfResult {
  taxableIncome: Decimal;
  legalDeductions: Decimal;
  simplifiedDiscount: Decimal;
  deductionMode: 'legal' | 'simplified';
  base: Decimal;
  rate: Decimal;
  bracketDeduction: Decimal;
  taxBeforeReduction: Decimal;
  reduction: Decimal;
  tax: Decimal;
}

function bracketFor(brackets: IrrfBracket[], base: Decimal): IrrfBracket {
  for (const b of brackets) if (b.upper === null || base.lte(b.upper)) return b;
  return brackets[brackets.length - 1];
}

function reductionFor(table: IrrfTable, income: Decimal, tax: Decimal): Decimal {
  const r = table.reduction;
  if (r === null || tax.lte(0)) return ZERO;
  if (income.lte(r.fullLimit)) return minBig(tax, r.fullAmount);
  if (income.lte(r.phaseOutLimit)) {
    const value = cents(r.intercept.minus(r.slope.times(income)));
    return maxBig(ZERO, minBig(tax, value));
  }
  return ZERO;
}

/** Monthly withholding (tabela progressiva mensal + redução da Lei 15.270/2025). */
export function irrfMonthly(
  taxableIncome: Decimal,
  inssAmount: Decimal,
  dependents: number,
  on: Day,
  otherDeductions: Decimal = ZERO,
  allowSimplified = true,
): IrrfResult {
  const table = irrfMonthlyTable(on);
  const income = dec(taxableIncome);
  const legal = dec(inssAmount).plus(table.dependentDeduction.times(dependents)).plus(dec(otherDeductions));
  const simplified = table.simplifiedDiscount ?? ZERO;
  const useSimplified = allowSimplified && simplified.gt(legal);
  const deduction = useSimplified ? simplified : legal;
  const base = maxBig(ZERO, income.minus(deduction));
  const b = bracketFor(table.brackets, base);
  const tax = maxBig(ZERO, cents(base.times(b.rate).minus(b.deduction)));
  const reduction = reductionFor(table, income, tax);
  return {
    taxableIncome: income,
    legalDeductions: cents(legal),
    simplifiedDiscount: simplified,
    deductionMode: useSimplified ? 'simplified' : 'legal',
    base: cents(base),
    rate: b.rate,
    bracketDeduction: b.deduction,
    taxBeforeReduction: tax,
    reduction,
    tax: cents(tax.minus(reduction)),
  };
}

export function irrfThirteenth(gross: Decimal, inssAmount: Decimal, dependents: number, on: Day): IrrfResult {
  return irrfMonthly(gross, inssAmount, dependents, on, ZERO, false);
}

/** Exclusive taxation of profit sharing (tabela PLR, valid from May 2025). */
export function plrTax(amount: Decimal): Decimal {
  const value = dec(amount);
  const b = bracketFor(PLR_TABLE, value);
  return maxBig(ZERO, cents(value.times(b.rate).minus(b.deduction)));
}

export interface ThirteenthResult {
  gross: Decimal;
  months: number;
  firstInstallment: Decimal;
  inss: Decimal;
  irrf: Decimal;
  secondInstallment: Decimal;
  netTotal: Decimal;
}

export function thirteenth(salary: Decimal, months: number, dependents: number, on: Day): ThirteenthResult {
  const value = dec(salary);
  const gross = cents(value.times(months).div(12));
  const first = cents(gross.div(2));
  const contribution = inss(gross, on).amount;
  const tax = irrfThirteenth(gross, contribution, dependents, on).tax;
  const second = cents(gross.minus(first).minus(contribution).minus(tax));
  return {
    gross,
    months,
    firstInstallment: first,
    inss: contribution,
    irrf: tax,
    secondInstallment: second,
    netTotal: cents(first.plus(second)),
  };
}

export interface PayLine {
  code: string;
  label: string;
  earning?: number;
  deduction?: number;
}

export interface VacationPayResult {
  dailyRate: Decimal;
  days: number;
  sellDays: number;
  vacationGross: Decimal;
  oneThird: Decimal;
  abono: Decimal;
  abonoOneThird: Decimal;
  advance13th: Decimal;
  inss: Decimal;
  irrf: Decimal;
  grossTotal: Decimal;
  netTotal: Decimal;
  lines: PayLine[];
}

export function vacationPay(
  salary: Decimal,
  days: number,
  sellDays: number,
  advance13th: boolean,
  dependents: number,
  on: Day,
): VacationPayResult {
  const value = dec(salary);
  const daily = value.div(30);
  const vacationGross = cents(daily.times(days));
  const third = cents(vacationGross.div(3));
  const abono = cents(daily.times(sellDays));
  const abonoThird = cents(abono.div(3));
  const advance = advance13th ? cents(value.div(2)) : ZERO;
  const taxable = vacationGross.plus(third);
  const contribution = inss(taxable, on).amount;
  const tax = irrfMonthly(taxable, contribution, dependents, on).tax;
  const grossTotal = cents(taxable.plus(abono).plus(abonoThird).plus(advance));
  const net = cents(grossTotal.minus(contribution).minus(tax));
  const lines: PayLine[] = [
    { code: 'FER', label: `Férias (${days} dias)`, earning: f(vacationGross) },
    { code: 'FER13', label: '1/3 constitucional de férias', earning: f(third) },
  ];
  if (sellDays) {
    lines.push({ code: 'ABN', label: `Abono pecuniário (${sellDays} dias)`, earning: f(abono) });
    lines.push({ code: 'ABN13', label: '1/3 sobre abono', earning: f(abonoThird) });
  }
  if (advance13th) lines.push({ code: 'AD13', label: 'Adiantamento 13º salário', earning: f(advance) });
  lines.push({ code: 'INSS', label: 'INSS sobre férias', deduction: f(contribution) });
  lines.push({ code: 'IRRF', label: 'IRRF sobre férias', deduction: f(tax) });
  return {
    dailyRate: cents(daily),
    days,
    sellDays,
    vacationGross,
    oneThird: third,
    abono,
    abonoOneThird: abonoThird,
    advance13th: advance,
    inss: contribution,
    irrf: tax,
    grossTotal,
    netTotal: net,
    lines,
  };
}

export interface PayslipInput {
  month: Day;
  salary: Decimal;
  dependents?: number;
  daysWorked?: number;
  overtimeHours?: Decimal;
  dsrRatio?: Decimal;
  vacationDays?: number;
  vacationSellDays?: number;
  healthShare?: Decimal;
  dentalShare?: Decimal;
  transportVoucher?: boolean;
  mealDiscount?: Decimal;
}

export interface Payslip {
  month: Day;
  lines: PayLine[];
  gross: Decimal;
  deductions: Decimal;
  net: Decimal;
  inssBase: Decimal;
  irrfBase: Decimal;
  fgts: Decimal;
  irrfDetail: { deduction_mode: string; tax_before_reduction: number; reduction: number };
}

interface RawLine {
  code: string;
  label: string;
  earning?: Decimal;
  deduction?: Decimal;
}

/** Monthly payslip with salary, overtime, DSR reflex, vacation and usual deductions. */
export function payslip(p: PayslipInput): Payslip {
  const salary = dec(p.salary);
  const on = p.month;
  const dependents = p.dependents ?? 0;
  const vacationDays = p.vacationDays ?? 0;
  const vacationSellDays = p.vacationSellDays ?? 0;
  const overtimeHours = p.overtimeHours ?? ZERO;
  const dsr = p.dsrRatio ?? ZERO;
  const lines: RawLine[] = [];
  const workedDays = Math.max(0, Math.min(30, p.daysWorked ?? 30) - vacationDays);
  const baseSalary = cents(salary.times(workedDays).div(30));
  lines.push({ code: 'SAL', label: `Salário base (${workedDays} dias)`, earning: baseSalary });
  const overtime = cents(salary.div(HOURS_DIVISOR).times(OVERTIME_RATE).times(dec(overtimeHours)));
  const dsrValue = cents(overtime.times(dec(dsr)));
  if (!overtime.eq(0)) {
    lines.push({ code: 'HE50', label: `Horas extras 50% (${gfmt(f(dec(overtimeHours)))} h)`, earning: overtime });
    lines.push({ code: 'DSRHE', label: 'DSR sobre horas extras', earning: dsrValue });
  }
  let vacGross = ZERO;
  let vacThird = ZERO;
  let abono = ZERO;
  let abonoThird = ZERO;
  if (vacationDays) {
    vacGross = cents(salary.div(30).times(vacationDays));
    vacThird = cents(vacGross.div(3));
    lines.push({ code: 'FER', label: `Férias (${vacationDays} dias)`, earning: vacGross });
    lines.push({ code: 'FER13', label: '1/3 constitucional de férias', earning: vacThird });
  }
  if (vacationSellDays) {
    abono = cents(salary.div(30).times(vacationSellDays));
    abonoThird = cents(abono.div(3));
    lines.push({ code: 'ABN', label: `Abono pecuniário (${vacationSellDays} dias)`, earning: abono });
    lines.push({ code: 'ABN13', label: '1/3 sobre abono', earning: abonoThird });
  }

  const salaryPart = baseSalary.plus(overtime).plus(dsrValue);
  const vacationPart = vacGross.plus(vacThird);
  const inssBase = salaryPart.plus(vacationPart);
  const contribution = inss(inssBase, on).amount;
  lines.push({ code: 'INSS', label: 'INSS', deduction: contribution });

  const inssVac = !inssBase.eq(0) && !vacationPart.eq(0) ? cents(contribution.times(vacationPart).div(inssBase)) : ZERO;
  const inssSal = contribution.minus(inssVac);
  const irrfSal = irrfMonthly(salaryPart, inssSal, dependents, on);
  lines.push({ code: 'IRRF', label: 'IRRF', deduction: irrfSal.tax });
  if (!vacationPart.eq(0)) {
    const irrfVac = irrfMonthly(vacationPart, inssVac, 0, on);
    lines.push({ code: 'IRRFFER', label: 'IRRF sobre férias', deduction: irrfVac.tax });
  }
  if (p.healthShare && !p.healthShare.eq(0)) {
    lines.push({ code: 'SAUDE', label: 'Plano de saúde (parte do colaborador)', deduction: cents(dec(p.healthShare)) });
  }
  if (p.dentalShare && !p.dentalShare.eq(0)) {
    lines.push({ code: 'ODONTO', label: 'Plano odontológico', deduction: cents(dec(p.dentalShare)) });
  }
  if (p.transportVoucher) lines.push({ code: 'VT', label: 'Vale-transporte (6%)', deduction: cents(baseSalary.times(VT_RATE)) });
  if (p.mealDiscount && !p.mealDiscount.eq(0)) {
    lines.push({ code: 'VR', label: 'Vale-refeição (participação)', deduction: cents(dec(p.mealDiscount)) });
  }

  let gross = ZERO;
  let deductions = ZERO;
  for (const ln of lines) {
    if (ln.earning) gross = gross.plus(ln.earning);
    if (ln.deduction) deductions = deductions.plus(ln.deduction);
  }
  const outLines: PayLine[] = lines.map((ln) => {
    const out: PayLine = { code: ln.code, label: ln.label };
    if (ln.earning !== undefined) out.earning = f(ln.earning);
    if (ln.deduction !== undefined) out.deduction = f(ln.deduction);
    return out;
  });
  return {
    month: on,
    lines: outLines,
    gross: cents(gross),
    deductions: cents(deductions),
    net: cents(gross.minus(deductions)),
    inssBase: cents(inssBase),
    irrfBase: irrfSal.base,
    fgts: cents(inssBase.times(FGTS_RATE)),
    irrfDetail: {
      deduction_mode: irrfSal.deductionMode,
      tax_before_reduction: f(irrfSal.taxBeforeReduction),
      reduction: f(irrfSal.reduction),
    },
  };
}

export interface NetSalary {
  gross: Decimal;
  inss: Decimal;
  irrf: Decimal;
  irrfReduction: Decimal;
  deductionMode: string;
  other: Decimal;
  net: Decimal;
}

export function netSalary(gross: Decimal, dependents: number, on: Day, otherDeductions: Decimal = ZERO): NetSalary {
  const value = dec(gross);
  const contribution = inss(value, on).amount;
  const tax = irrfMonthly(value, contribution, dependents, on);
  const other = cents(dec(otherDeductions));
  return {
    gross: cents(value),
    inss: contribution,
    irrf: tax.tax,
    irrfReduction: tax.reduction,
    deductionMode: tax.deductionMode,
    other,
    net: cents(value.minus(contribution).minus(tax.tax).minus(other)),
  };
}
