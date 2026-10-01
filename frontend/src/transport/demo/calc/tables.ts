/** Official tax tables, versioned by validity date (port of `atrium.calculators.tables`). */
import { type Day, day, lte } from '../core/date';
import { type Decimal, dec } from '../core/money';

export interface InssTable {
  validFrom: Day;
  /** (upper bound of the bracket, rate); the last upper bound is the contribution ceiling. */
  brackets: [Decimal, Decimal][];
  source: string;
}

export interface IrrfBracket {
  upper: Decimal | null;
  rate: Decimal;
  deduction: Decimal;
}

export interface IncomeReduction {
  fullLimit: Decimal;
  fullAmount: Decimal;
  phaseOutLimit: Decimal;
  intercept: Decimal;
  slope: Decimal;
}

export interface IrrfTable {
  validFrom: Day;
  brackets: IrrfBracket[];
  dependentDeduction: Decimal;
  simplifiedDiscount: Decimal | null;
  reduction: IncomeReduction | null;
  source: string;
  simplifiedRate?: Decimal | null;
}

export const INSS_TABLES: InssTable[] = [
  {
    validFrom: day(2025, 1, 1),
    brackets: [
      [dec('1518.00'), dec('0.075')],
      [dec('2793.88'), dec('0.09')],
      [dec('4190.83'), dec('0.12')],
      [dec('8157.41'), dec('0.14')],
    ],
    source: 'Portaria Interministerial MPS/MF nº 6/2025',
  },
  {
    validFrom: day(2026, 1, 1),
    brackets: [
      [dec('1621.00'), dec('0.075')],
      [dec('2902.84'), dec('0.09')],
      [dec('4354.27'), dec('0.12')],
      [dec('8475.55'), dec('0.14')],
    ],
    source: 'Portaria Interministerial MPS/MF nº 13/2026',
  },
];

const MONTHLY_2025_JAN_APR: IrrfBracket[] = [
  { upper: dec('2259.20'), rate: dec('0'), deduction: dec('0') },
  { upper: dec('2826.65'), rate: dec('0.075'), deduction: dec('169.44') },
  { upper: dec('3751.05'), rate: dec('0.15'), deduction: dec('381.44') },
  { upper: dec('4664.68'), rate: dec('0.225'), deduction: dec('662.77') },
  { upper: null, rate: dec('0.275'), deduction: dec('896.00') },
];

const MONTHLY_FROM_2025_05: IrrfBracket[] = [
  { upper: dec('2428.80'), rate: dec('0'), deduction: dec('0') },
  { upper: dec('2826.65'), rate: dec('0.075'), deduction: dec('182.16') },
  { upper: dec('3751.05'), rate: dec('0.15'), deduction: dec('394.16') },
  { upper: dec('4664.68'), rate: dec('0.225'), deduction: dec('675.49') },
  { upper: null, rate: dec('0.275'), deduction: dec('908.73') },
];

export const MONTHLY_REDUCTION_2026: IncomeReduction = {
  fullLimit: dec('5000.00'),
  fullAmount: dec('312.89'),
  phaseOutLimit: dec('7350.00'),
  intercept: dec('978.62'),
  slope: dec('0.133145'),
};

export const ANNUAL_REDUCTION_2026: IncomeReduction = {
  fullLimit: dec('60000.00'),
  fullAmount: dec('2694.15'),
  phaseOutLimit: dec('88200.00'),
  intercept: dec('8429.73'),
  slope: dec('0.095575'),
};

export const IRRF_MONTHLY_TABLES: IrrfTable[] = [
  {
    validFrom: day(2025, 1, 1),
    brackets: MONTHLY_2025_JAN_APR,
    dependentDeduction: dec('189.59'),
    simplifiedDiscount: dec('564.80'),
    reduction: null,
    source: 'Lei 14.848/2024',
  },
  {
    validFrom: day(2025, 5, 1),
    brackets: MONTHLY_FROM_2025_05,
    dependentDeduction: dec('189.59'),
    simplifiedDiscount: dec('607.20'),
    reduction: null,
    source: 'Lei 15.191/2025',
  },
  {
    validFrom: day(2026, 1, 1),
    brackets: MONTHLY_FROM_2025_05,
    dependentDeduction: dec('189.59'),
    simplifiedDiscount: dec('607.20'),
    reduction: MONTHLY_REDUCTION_2026,
    source: 'Lei 15.191/2025 + Lei 15.270/2025',
  },
];

export const IRPF_ANNUAL_2026: IrrfTable = {
  validFrom: day(2026, 1, 1),
  brackets: [
    { upper: dec('29145.60'), rate: dec('0'), deduction: dec('0') },
    { upper: dec('33919.80'), rate: dec('0.075'), deduction: dec('2185.92') },
    { upper: dec('45012.60'), rate: dec('0.15'), deduction: dec('4729.91') },
    { upper: dec('55976.16'), rate: dec('0.225'), deduction: dec('8105.85') },
    { upper: null, rate: dec('0.275'), deduction: dec('10904.66') },
  ],
  dependentDeduction: dec('2275.08'),
  simplifiedDiscount: dec('17640.00'),
  reduction: ANNUAL_REDUCTION_2026,
  source: 'RFB Tributação de 2026 (incidência anual) + Lei 15.270/2025',
  simplifiedRate: dec('0.20'),
};

export const PLR_TABLE: IrrfBracket[] = [
  { upper: dec('8214.40'), rate: dec('0'), deduction: dec('0') },
  { upper: dec('9922.28'), rate: dec('0.075'), deduction: dec('616.08') },
  { upper: dec('13167.00'), rate: dec('0.15'), deduction: dec('1360.25') },
  { upper: dec('16380.38'), rate: dec('0.225'), deduction: dec('2347.78') },
  { upper: null, rate: dec('0.275'), deduction: dec('3166.80') },
];

export const EDUCATION_ANNUAL_LIMIT_2026 = dec('3561.50');

function pick<T extends { validFrom: Day }>(tables: T[], on: Day): T {
  let chosen: T | null = null;
  for (const t of tables) if (lte(t.validFrom, on)) chosen = t;
  if (chosen === null) throw new Error(`no table valid on ${on.toISOString().slice(0, 10)}`);
  return chosen;
}

export function inssTable(on: Day): InssTable {
  return pick(INSS_TABLES, on);
}

export function irrfMonthlyTable(on: Day): IrrfTable {
  return pick(IRRF_MONTHLY_TABLES, on);
}
