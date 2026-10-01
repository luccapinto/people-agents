/** Compensation and payroll tools (agent: Remuneração e Folha). All math is in calculators. */
import { addDays, day, firstOfMonth, fromISO, lt, month, monthKey, pad2, toISO, year } from '../core/date';
import { type Decimal, ZERO, cents, dec, f } from '../core/money';
import { dsrRatio, holidayMap } from '../calc/holidays';
import { type PayLine, type PayslipInput, netSalary, payslip, thirteenth } from '../calc/payroll';
import { pgblSimulation } from '../calc/pgbl';
import type { HRSession } from '../data/store';
import type { RawPayslipLine } from '../data/types';
import type { ToolDef } from '../runtime/registry';
import { type ToolContext, ToolError, type ToolResult, fail } from '../runtime/tool';
import { MONTHS, currentSalary, d, irDependents, money, monthLabel, pct } from './util';

const TAXABLE_EXCLUDED = ['ABN', 'ABN13'];

function healthCosts(hr: HRSession, employeeId: string): [Decimal, Decimal] {
  const plans = new Map(hr.benefits.plans().map((p) => [p.id, p]));
  let health = ZERO;
  let dental = ZERO;
  for (const e of hr.benefits.enrollments(employeeId)) {
    const p = plans.get(e.plan_id);
    if (!p) continue;
    const cost = dec(String(p.employee_cost)).plus(dec(String(p.dependent_cost)).times(e.dependents.length));
    if (p.kind === 'health') health = cost;
    else dental = cost;
  }
  return [health, dental];
}

export interface ProjectionMonth {
  month: string;
  label: string;
  gross: number;
  net: number;
  kind: string;
}

export interface Projection {
  year: number;
  salary: number;
  months: ProjectionMonth[];
  items: Record<string, number>;
  thirteenth: { gross: number; first: number; second_net: number; inss: number; irrf: number };
  total_gross: number;
  total_net: number;
  taxable_income: number;
  inss_paid: number;
  irrf_paid: number;
  health_annual: number;
  dependents: number;
  actual_until: string | null;
  notes?: string[];
}

export function projection(ctx: ToolContext, y: number): Projection {
  const eid = ctx.identity.employeeId;
  const hr = ctx.hr();
  const history = hr.payroll.salaryHistory(eid);
  const slips = hr.payroll.payslips(eid, y);
  const deps = irDependents(hr.benefits.dependents(eid));
  const [health, dental] = healthCosts(hr, eid);
  const requests = hr.vacation.requests(eid);
  const balances = hr.benefits.balances(eid);
  const salary = currentSalary(history);
  const hire = ctx.identity.hireDate;
  const hmap = holidayMap([y]);
  const months: ProjectionMonth[] = [];
  const items: Record<string, Decimal> = {
    salaries: ZERO,
    overtime: ZERO,
    vacation: ZERO,
    vacation_third: ZERO,
    thirteenth: ZERO,
    plr: ZERO,
  };
  let taxable = ZERO;
  let inssTotal = ZERO;
  let irrfTotal = ZERO;
  const actual = new Map(slips.filter((p) => p.kind === 'monthly').map((p) => [p.month, p]));
  const extras = new Map(slips.filter((p) => p.kind === 'plr').map((p) => [p.month, p]));
  for (let m = 1; m <= 12; m += 1) {
    const key = `${y}-${pad2(m)}`;
    const first = day(y, m, 1);
    if (lt(first, firstOfMonth(hire))) continue;
    let lines: (PayLine | RawPayslipLine)[];
    let gross: Decimal;
    let net: Decimal;
    let kind: string;
    const paid = actual.get(key);
    if (paid) {
      lines = paid.lines;
      gross = dec(String(paid.gross));
      net = dec(String(paid.net));
      kind = 'actual';
    } else {
      let vac = 0;
      for (const r of requests) {
        if (['approved', 'pending_manager', 'taken'].includes(r.status)) {
          for (let i = 0; i < r.days; i += 1) {
            const dayValue = addDays(r.start, i);
            if (month(dayValue) === m && year(dayValue) === y) vac += 1;
          }
        }
      }
      const input: PayslipInput = {
        month: first,
        salary,
        dependents: deps,
        vacationDays: Math.min(30, vac),
        dsrRatio: dec(ZERO.toString()),
        healthShare: health,
        dentalShare: dental,
        transportVoucher: Boolean(balances?.transport_voucher),
      };
      const [rest, useful] = dsrRatio(y, m, hmap).split('/');
      input.dsrRatio = dec(rest).div(dec(useful));
      const ps = payslip(input);
      lines = ps.lines;
      gross = ps.gross;
      net = ps.net;
      kind = 'projected';
    }
    for (const ln of lines) {
      const e = dec(String(ln.earning ?? 0));
      const code = ln.code;
      if (code === 'SAL') items.salaries = items.salaries.plus(e);
      else if (code === 'HE50' || code === 'DSRHE') items.overtime = items.overtime.plus(e);
      else if (code === 'FER') items.vacation = items.vacation.plus(e);
      else if (code === 'FER13' || code === 'ABN' || code === 'ABN13') items.vacation_third = items.vacation_third.plus(e);
      if (!TAXABLE_EXCLUDED.includes(code)) taxable = taxable.plus(e);
      if (code === 'INSS') inssTotal = inssTotal.plus(dec(String(ln.deduction)));
      if (code.startsWith('IRRF')) irrfTotal = irrfTotal.plus(dec(String(ln.deduction)));
    }
    let extraGross = ZERO;
    let extraNet = ZERO;
    const plrSlip = extras.get(key);
    if (plrSlip) {
      items.plr = items.plr.plus(dec(String(plrSlip.gross)));
      extraGross = extraGross.plus(dec(String(plrSlip.gross)));
      extraNet = extraNet.plus(dec(String(plrSlip.net)));
    }
    months.push({
      month: key,
      label: MONTHS[m - 1].slice(0, 3),
      gross: f(gross.plus(extraGross)),
      net: f(net.plus(extraNet)),
      kind,
    });
  }
  const monthsWorked = months.length;
  const t13 = thirteenth(salary, monthsWorked, deps, day(y, 12, 1));
  items.thirteenth = t13.gross;
  for (const mm of months) {
    if (mm.month === `${y}-11`) {
      mm.gross = f(dec(String(mm.gross)).plus(t13.firstInstallment));
      mm.net = f(dec(String(mm.net)).plus(t13.firstInstallment));
    }
    if (mm.month === `${y}-12`) {
      mm.gross = f(dec(String(mm.gross)).plus(t13.gross).minus(t13.firstInstallment));
      mm.net = f(dec(String(mm.net)).plus(t13.secondInstallment));
    }
  }
  const totalGross = months.reduce((sum, mm) => sum.plus(dec(String(mm.gross))), ZERO);
  const totalNet = months.reduce((sum, mm) => sum.plus(dec(String(mm.net))), ZERO);
  const actualMonths = months.filter((mm) => mm.kind === 'actual').map((mm) => mm.month);
  const itemsOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(items)) itemsOut[k] = Number(cents(v).toString());
  return {
    year: y,
    salary: f(salary),
    months,
    items: itemsOut,
    thirteenth: {
      gross: f(t13.gross),
      first: f(t13.firstInstallment),
      second_net: f(t13.secondInstallment),
      inss: f(t13.inss),
      irrf: f(t13.irrf),
    },
    total_gross: Number(cents(totalGross).toString()),
    total_net: Number(cents(totalNet).toString()),
    taxable_income: Number(cents(taxable).toString()),
    inss_paid: Number(cents(inssTotal).toString()),
    irrf_paid: Number(cents(irrfTotal).toString()),
    health_annual: Number(cents(health.times(12)).toString()),
    dependents: deps,
    actual_until: actualMonths.length ? actualMonths.reduce((best, m) => (m > best ? m : best)) : null,
  };
}

export const payrollTools: ToolDef[] = [
  {
    name: 'payroll_get_salary',
    action: 'self.payroll.read',
    params: {},
    handler: (ctx): ToolResult => {
      const history = ctx.hr().payroll.salaryHistory(ctx.subjectId as string);
      if (!history.length) return fail('Não encontrei histórico salarial.');
      const current = history[history.length - 1];
      const rows = history.map((h) => [toISO(h.effective_date), h.salary, h.reason]);
      const first = dec(String(history[0].salary));
      const growth = first.eq(0) ? ZERO : dec(String(current.salary)).div(first).minus(1).times(100);
      const data = {
        title: 'Salário e histórico',
        current_salary: current.salary,
        since: toISO(current.effective_date),
        columns: ['Vigência', 'Salário', 'Motivo'],
        rows,
        money_columns: [1],
        growth_percent: Number(cents(growth).toString()),
      };
      let summary = `Seu salário atual é ${money(current.salary)}, vigente desde ${d(current.effective_date)} (${current.reason}).`;
      if (history.length > 1) summary += ` Desde a admissão o salário evoluiu ${pct(Number(growth.toString()))}.`;
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'payroll_get_payslip',
    action: 'self.payroll.read',
    params: {
      month: {
        type: 'str',
        optional: true,
        default: null,
        pattern: /^\d{4}-\d{2}$/,
        description: 'Competência AAAA-MM (padrão: último mês pago)',
      },
      kind: { type: 'str', default: 'monthly', description: 'monthly (mensal) ou plr' },
    },
    handler: (ctx, args): ToolResult => {
      const slips = ctx.hr().payroll.payslips(ctx.subjectId as string);
      let candidates = slips.filter((p) => p.kind === args.kind);
      if (args.month) candidates = candidates.filter((p) => p.month === args.month);
      if (!candidates.length) {
        return fail(
          `Não encontrei holerite para essa competência.${
            slips.length ? ` O último disponível é de ${monthLabel(slips[slips.length - 1].month)}.` : ''
          }`,
        );
      }
      const p = candidates[candidates.length - 1];
      const data = {
        id: p.id,
        month: p.month,
        month_label: monthLabel(p.month),
        kind: p.kind,
        lines: p.lines.map((ln) => {
          const out: Record<string, unknown> = { code: ln.code, label: ln.label };
          if (ln.earning !== undefined && ln.earning !== null) out.earning = ln.earning;
          if (ln.deduction !== undefined && ln.deduction !== null) out.deduction = ln.deduction;
          return out;
        }),
        gross: p.gross,
        deductions: p.deductions,
        net: p.net,
        inss_base: p.inss_base,
        irrf_base: p.irrf_base,
        fgts: p.fgts,
        paid_on: p.paid_on,
        pdf_url: `/api/documents/payslip/${p.month}?kind=${p.kind}`,
      };
      const withDeduction = p.lines.filter((ln) => ln.deduction);
      const biggest = withDeduction.length
        ? withDeduction.reduce((best, ln) => ((ln.deduction ?? 0) > (best.deduction ?? 0) ? ln : best))
        : null;
      let summary =
        `No holerite de ${monthLabel(p.month)} o bruto foi ${money(p.gross)}, os descontos ${money(p.deductions)} ` +
        `e o líquido ${money(p.net)}, pago em ${d(fromISO(p.paid_on))}.`;
      if (biggest) summary += ` O maior desconto foi ${biggest.label} (${money(biggest.deduction as number)}).`;
      return { data, summary, card: { type: 'payslip', data } };
    },
  },
  {
    name: 'payroll_annual_projection',
    action: 'self.payroll.read',
    params: { year: { type: 'int', optional: true, default: null, description: 'Ano (padrão: ano atual)' } },
    handler: (ctx, args): ToolResult => {
      const y = (args.year as number | null) ?? year(ctx.today);
      if (y !== year(ctx.today)) throw new ToolError(`A projeção está disponível para ${year(ctx.today)}.`);
      const data = projection(ctx, y);
      data.notes = [
        'Meses já pagos vêm dos holerites; os demais são projetados com o salário atual e as férias agendadas.',
        '13º e PLR têm tributação exclusiva na fonte.',
        'PLR de 2026 é paga em março de 2027 e não entra nesta projeção.',
      ];
      let summary =
        `Em ${y} você deve receber ${money(data.total_gross)} brutos e cerca de ${money(data.total_net)} líquidos, ` +
        `incluindo 13º de ${money(data.thirteenth.gross)}`;
      if (data.items.plr) summary += `, PLR de ${money(data.items.plr)}`;
      if (data.items.vacation_third) summary += ` e ${money(data.items.vacation_third)} de 1/3 e abono de férias`;
      summary += '.';
      return { data: data as unknown as Record<string, unknown>, summary, card: { type: 'annual_projection', data: data as unknown as Record<string, unknown> } };
    },
  },
  {
    name: 'payroll_simulate_net',
    action: 'self.payroll.read',
    params: {
      gross: { type: 'float', optional: true, default: null, gt: 0, description: 'Salário bruto mensal a simular (padrão: o atual)' },
      dependents: { type: 'int', optional: true, default: null, ge: 0, le: 10, description: 'Dependentes para IR (padrão: os cadastrados)' },
    },
    handler: (ctx, args): ToolResult => {
      const hr = ctx.hr();
      const salary = currentSalary(hr.payroll.salaryHistory(ctx.subjectId as string));
      const deps = irDependents(hr.benefits.dependents(ctx.subjectId as string));
      const gross = args.gross ? dec(String(args.gross)) : salary;
      const n = args.dependents !== null && args.dependents !== undefined ? (args.dependents as number) : deps;
      const r = netSalary(gross, n, ctx.today);
      const lines = [
        { label: 'Salário bruto', value: f(r.gross), kind: 'earning' },
        { label: 'INSS (progressivo 2026)', value: f(r.inss), kind: 'deduction' },
        {
          label: `IRRF${r.irrfReduction.eq(0) ? '' : ' (com redução da Lei 15.270/2025)'}`,
          value: f(r.irrf),
          kind: 'deduction',
        },
      ];
      const data = {
        title: 'Simulação de salário líquido',
        lines,
        gross: f(r.gross),
        deductions: f(r.inss.plus(r.irrf)),
        net: f(r.net),
        notes: [
          `Dedução do IRRF: ${r.deductionMode === 'simplified' ? 'desconto simplificado' : 'deduções legais'}; ${n} dependente(s).`,
          'Não inclui descontos de benefícios.',
        ],
      };
      return {
        data,
        summary: `Com bruto de ${money(r.gross)}, o líquido estimado é ${money(r.net)} (INSS ${money(r.inss)}, IRRF ${money(r.irrf)}).`,
        card: { type: 'breakdown', data },
      };
    },
  },
  {
    name: 'payroll_simulate_pgbl',
    action: 'self.payroll.read',
    params: {
      contribution_percent: {
        type: 'float',
        optional: true,
        default: null,
        ge: 0,
        le: 12,
        description: 'Percentual da renda tributável a contribuir (padrão: 12%)',
      },
    },
    handler: (ctx, args): ToolResult => {
      const p = projection(ctx, year(ctx.today));
      const income = dec(String(p.taxable_income));
      const percent = args.contribution_percent as number | null;
      const contribution = percent !== null && percent !== undefined ? cents(income.times(dec(String(percent))).div(100)) : null;
      const s = pgblSimulation(
        income,
        dec(String(p.inss_paid)),
        p.dependents,
        dec(String(p.health_annual)),
        ZERO,
        contribution,
      );
      const data = {
        year: p.year,
        taxable_income: f(s.taxableIncome),
        limit: f(s.limit),
        contribution: f(s.contribution),
        monthly_contribution: f(s.monthlyContribution),
        tax_saving: f(s.taxSaving),
        eligible: s.eligible,
        best_model_without_pgbl: s.bestWithoutPgbl.model,
        tax_without_pgbl: f(s.bestWithoutPgbl.tax),
        tax_with_pgbl: f(s.completeWithPgbl.tax),
        scenarios: s.scenarios,
        recommendation: s.recommendation,
        assumptions: [
          `Renda tributável estimada de ${p.year}: salários, horas extras e férias (sem 13º e PLR).`,
          `Deduções: INSS ${money(p.inss_paid)}, ${p.dependents} dependente(s), plano de saúde ${money(p.health_annual)}.`,
          'Vale para quem declara no modelo completo e contribui para o INSS.',
          'No resgate do PGBL o imposto incide sobre o valor total (regime progressivo ou regressivo).',
        ],
      };
      const summary = s.taxSaving.gt(0)
        ? `Contribuindo ${money(s.contribution)} no ano (cerca de ${money(s.monthlyContribution)} por mês, o limite de 12% ` +
          `da sua renda tributável de ${money(s.taxableIncome)}), a economia estimada de IR é ${money(s.taxSaving)}: ` +
          `o imposto anual cai de ${money(s.bestWithoutPgbl.tax)} para ${money(s.completeWithPgbl.tax)}.`
        : s.recommendation;
      return { data, summary, card: { type: 'pgbl_simulation', data } };
    },
  },
];

export { monthKey };
