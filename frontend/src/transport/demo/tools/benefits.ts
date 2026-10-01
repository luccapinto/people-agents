/** Benefits tools (agent: Benefícios). */
import { type Day, addDays, day, diffDays, dayOf, fromISO, gte, lte, month, toISO, year } from '../core/date';
import { type Decimal, ZERO, dec, f, pyRound } from '../core/money';
import { fold } from '../core/text';
import type { DependentRow } from '../data/store';
import type { RawBalances, RawEnrollment, RawPlan } from '../data/types';
import type { ToolDef } from '../runtime/registry';
import { type ToolContext, ToolError, type ToolResult, fail } from '../runtime/tool';
import { currentSalary, d, money, plural } from './util';

const TIER: Record<string, number> = { 'PLN-ESS': 1, 'PLN-PLUS': 2, 'PLN-PREM': 3, 'ODO-BAS': 1, 'ODO-PLUS': 2 };

interface Loaded {
  plans: Map<string, RawPlan>;
  enrollments: RawEnrollment[];
  dependents: DependentRow[];
  balances: RawBalances | null;
  salary: Decimal;
}

function load(ctx: ToolContext): Loaded {
  const eid = ctx.identity.employeeId;
  const hr = ctx.hr();
  return {
    plans: new Map(hr.benefits.plans().map((p) => [p.id, p])),
    enrollments: hr.benefits.enrollments(eid),
    dependents: hr.benefits.dependents(eid),
    balances: hr.benefits.balances(eid),
    salary: currentSalary(hr.payroll.salaryHistory(eid)),
  };
}

function cost(plan: RawPlan, nDeps: number): number {
  return f(dec(String(plan.employee_cost)).plus(dec(String(plan.dependent_cost)).times(nDeps)));
}

function findPlan(plans: Map<string, RawPlan>, query: string): RawPlan | null {
  const q = fold(query);
  for (const p of plans.values()) {
    const name = fold(p.name);
    const parts = name.split(' ');
    if (q === fold(p.id) || q === name || parts[parts.length - 1] === q || name.includes(q)) return p;
  }
  return null;
}

function changeWindow(ctx: ToolContext, dependents: DependentRow[]): [string, Day] {
  const rule = (ctx.services.companyPolicies().benefits as Record<string, Record<string, unknown>>).plan_change as Record<
    string,
    string | number
  >;
  const t = ctx.today;
  const parse = (value: string): [number, number] => value.split('-').map(Number) as [number, number];
  const [sm, sd] = parse(String(rule.annual_window_start));
  const [em, ed] = parse(String(rule.annual_window_end));
  const [fm, fd] = parse(String(rule.annual_window_effective));
  const start = day(year(t), sm, sd);
  const end = day(year(t), em, ed);
  const effective = day(year(t), fm, fd);
  const recent = dependents.filter(
    (x) => diffDays(t, x.birth_date) <= Number(rule.life_event_window_days) && x.relationship === 'filho(a)',
  );
  if (recent.length) {
    const nxt = day(year(t) + (month(t) === 12 ? 1 : 0), (month(t) % 12) + 1, 1);
    return ['evento de vida (nascimento)', nxt];
  }
  if (lte(start, t) && lte(t, end)) return ['janela anual', effective];
  if (t.getTime() < start.getTime()) return [`agendada para a janela anual (${d(start)} a ${d(end)})`, effective];
  return ['agendada para a próxima janela anual', day(year(t) + 1, month(effective), dayOf(effective))];
}

export const benefitsTools: ToolDef[] = [
  {
    name: 'benefits_get_summary',
    action: 'self.benefits.read',
    params: {},
    handler: (ctx): ToolResult => {
      const { plans, enrollments, dependents, balances, salary } = load(ctx);
      const depNames = new Map(dependents.map((x) => [x.id, x.name]));
      const out: Record<string, unknown> & { plans: Record<string, unknown>[] } = { plans: [] };
      for (const e of enrollments) {
        const p = plans.get(e.plan_id);
        if (!p) continue;
        out.plans.push({
          kind: p.kind,
          plan_id: p.id,
          name: p.name,
          operator: p.operator,
          since: e.since,
          accommodation: p.accommodation,
          coverage: p.coverage,
          copay: p.copay,
          dependents: e.dependents.map((x) => depNames.get(x) ?? x),
          monthly_cost: cost(p, e.dependents.length),
        });
      }
      if (balances) {
        Object.assign(out, {
          meal_card_monthly: balances.meal_card_monthly,
          food_card_monthly: balances.food_card_monthly,
          flex_balance: balances.flex_balance,
          daycare_children: balances.daycare_children,
          daycare_monthly_per_child: balances.daycare_monthly_per_child,
          life_insurance_coverage: f(salary.times(balances.life_insurance_multiple)),
          life_insurance_multiple: balances.life_insurance_multiple,
          wellness: balances.wellness,
          transport_voucher: balances.transport_voucher,
        });
      }
      const health = out.plans.find((p) => p.kind === 'health');
      let summary = 'Seus benefícios:';
      if (health) {
        const deps = (health.dependents as string[]).length
          ? ` com ${plural((health.dependents as string[]).length, 'dependente', 'dependentes')}`
          : '';
        summary += ` plano de saúde ${health.name}${deps} (custo mensal para você ${money(health.monthly_cost as number)});`;
      }
      if (balances) {
        summary +=
          ` vale-refeição de ${money(balances.meal_card_monthly)} e vale-alimentação de ${money(balances.food_card_monthly)} por mês;` +
          ` saldo flexível de ${money(balances.flex_balance)}; seguro de vida de ${balances.life_insurance_multiple} salários.`;
      }
      return { data: out, summary, card: { type: 'benefits_summary', data: out } };
    },
  },
  {
    name: 'benefits_compare_plans',
    action: 'self.benefits.read',
    params: { kind: { type: 'str', default: 'health', description: 'health (saúde) ou dental (odontológico)' } },
    handler: (ctx, args): ToolResult => {
      const kind = String(args.kind);
      if (kind !== 'health' && kind !== 'dental') {
        throw new ToolError('Escolha planos de saúde (health) ou odontológicos (dental).');
      }
      const { plans, enrollments } = load(ctx);
      const current = enrollments.find((e) => plans.get(e.plan_id)?.kind === kind) ?? null;
      const n = current ? current.dependents.length : 0;
      const currentCost = current ? cost(plans.get(current.plan_id) as RawPlan, n) : 0;
      const rows = [...plans.values()]
        .filter((p) => p.kind === kind)
        .sort((a, b) => (TIER[a.id] ?? 0) - (TIER[b.id] ?? 0))
        .map((p) => {
          const c = cost(p, n);
          return {
            plan_id: p.id,
            name: p.name,
            accommodation: p.accommodation,
            coverage: p.coverage,
            copay: p.copay,
            reimbursement: p.reimbursement,
            highlights: p.highlights,
            monthly_cost: c,
            annual_cost: pyRound(c * 12, 2),
            difference: pyRound(c - currentCost, 2),
            current: Boolean(current && current.plan_id === p.id),
          };
        });
      const rule = (ctx.services.companyPolicies().benefits as Record<string, Record<string, unknown>>).plan_change as Record<
        string,
        string | number
      >;
      const ws = String(rule.annual_window_start);
      const we = String(rule.annual_window_end);
      const data = {
        kind,
        dependents_on_plan: n,
        plans: rows,
        rules: [
          `Troca na janela anual de ${ws.slice(3)}/${ws.slice(0, 2)} a ${we.slice(3)}/${we.slice(0, 2)}, vigência em 01/12.`,
          `Evento de vida (nascimento, casamento): até ${rule.life_event_window_days} dias.`,
          `Upgrade: carência de ${rule.upgrade_waiting_days} dias para internação em apartamento.`,
        ],
      };
      const cur = rows.find((r) => r.current);
      let summary = `Comparei ${rows.length} planos considerando ${plural(n, 'dependente', 'dependentes')} no plano.`;
      if (cur) {
        const others = rows
          .filter((r) => !r.current)
          .map(
            (r) =>
              `${r.name} custaria ${money(r.monthly_cost)}/mês (${r.difference >= 0 ? '+' : '-'}${money(Math.abs(r.difference))})`,
          )
          .join('; ');
        summary += ` Hoje você paga ${money(cur.monthly_cost)}/mês no ${cur.name}. ${others}.`;
      }
      return { data, summary, card: { type: 'plan_comparison', data } };
    },
  },
  {
    name: 'benefits_change_plan',
    action: 'self.benefits.change',
    params: { plan: { type: 'str', description: 'Nome ou código do plano desejado (ex.: Vitalis Plus)' } },
    executor: (ctx, args): ToolResult => {
      const { plans, enrollments } = load(ctx);
      const target = plans.get(String(args.to_plan)) as RawPlan;
      const current = enrollments.find((e) => plans.get(e.plan_id)?.kind === target.kind) as RawEnrollment;
      const req = ctx
        .hr()
        .benefits.requestPlanChange(
          ctx.identity.employeeId,
          current.plan_id,
          target.id,
          fromISO(String(args.effective)),
          String(args.reason),
        );
      return {
        data: { request_id: req.id, effective: req.effective_date },
        summary: `Troca para ${target.name} registrada (${req.id}), com vigência em ${d(req.effective_date_day)}.`,
      };
    },
    handler: (ctx, args): ToolResult => {
      const { plans, enrollments, dependents } = load(ctx);
      const target = findPlan(plans, String(args.plan));
      if (target === null) {
        return fail(
          `Não encontrei o plano “${args.plan}”. Planos: ${[...plans.values()].map((p) => p.name).join(', ')}`,
        );
      }
      const current = enrollments.find((e) => plans.get(e.plan_id)?.kind === target.kind) ?? null;
      if (current && current.plan_id === target.id) return fail(`Você já está no ${target.name}.`);
      const [reason, effective] = changeWindow(ctx, dependents);
      const n = current ? current.dependents.length : 0;
      const old = current ? (plans.get(current.plan_id) as RawPlan) : null;
      const upgrade = (TIER[target.id] ?? 0) > (old ? (TIER[old.id] ?? 0) : 0);
      const rule = (ctx.services.companyPolicies().benefits as Record<string, Record<string, unknown>>).plan_change as Record<
        string,
        string | number
      >;
      const details = [
        { label: 'De', value: old ? old.name : 'sem plano' },
        { label: 'Para', value: target.name },
        { label: 'Vigência', value: d(effective) },
        { label: 'Motivo', value: reason },
        { label: 'Novo custo mensal', value: `${money(cost(target, n))} (${plural(n, 'dependente', 'dependentes')})` },
      ];
      if (upgrade) {
        const until = addDays(effective, Number(rule.upgrade_waiting_days));
        details.push({
          label: 'Carência',
          value: `internação em apartamento a partir de ${d(until)} (${rule.upgrade_waiting_days} dias)`,
        });
      }
      return {
        data: { to_plan: target.id, effective: toISO(effective), upgrade },
        summary:
          `Preparei a troca para o ${target.name} com vigência em ${d(effective)} (${reason}). ` +
          'Por ser ação sensível, a confirmação pede verificação de identidade.',
        proposal: {
          summary: `Trocar ${old ? old.name : 'plano'} por ${target.name}`,
          details,
          args: { to_plan: target.id, effective: toISO(effective), reason },
        },
      };
    },
  },
  {
    name: 'benefits_enroll_newborn',
    action: 'self.benefits.change',
    params: {
      birth_date: { type: 'date', description: 'Data de nascimento (AAAA-MM-DD)' },
      name: { type: 'str', optional: true, default: null, description: 'Nome do bebê, se já definido' },
    },
    executor: (ctx, args): ToolResult => {
      const born = fromISO(String(args.birth_date));
      const eid = ctx.identity.employeeId;
      const hr = ctx.hr();
      const existing =
        hr.benefits.dependents(eid).find((x) => x.birth_date.getTime() === born.getTime() && x.relationship === 'filho(a)') ??
        null;
      const depRow =
        existing ??
        hr.benefits.addDependent(
          eid,
          (args.name as string | null) || 'Recém-nascido (nome a informar)',
          'filho(a)',
          born,
          false,
          true,
          'aguardando certidão',
        );
      hr.benefits.enrollDependent(eid, depRow.id);
      return {
        data: { dependent_id: depRow.id },
        summary: 'Inclusão no plano registrada; envie a certidão de nascimento ao DP.',
      };
    },
    handler: (ctx, args): ToolResult => {
      const rule = (ctx.services.companyPolicies().benefits as Record<string, Record<string, unknown>>).newborn as Record<
        string,
        number
      >;
      const birth = args.birth_date as Day;
      const deadline = addDays(birth, Number(rule.enroll_within_days));
      const { plans, enrollments } = load(ctx);
      const health = enrollments.find((e) => plans.get(e.plan_id)?.kind === 'health') ?? null;
      if (health === null) return fail('Você não tem plano de saúde ativo para incluir dependentes.');
      const plan = plans.get(health.plan_id) as RawPlan;
      const late = ctx.today.getTime() > deadline.getTime();
      const details = [
        { label: 'Plano', value: plan.name },
        { label: 'Prazo sem carência', value: `até ${d(deadline)} (Lei 9.656/1998, art. 12)` },
        { label: 'Custo adicional', value: `${money(plan.dependent_cost)}/mês` },
        { label: 'Documento', value: 'certidão de nascimento' },
      ];
      if (late) details.push({ label: 'Atenção', value: 'O prazo de 30 dias passou: a inclusão terá carência.' });
      const data = { plan: plan.name, deadline: toISO(deadline), dependent_cost: plan.dependent_cost, late };
      return {
        data,
        summary:
          `O bebê pode entrar no ${plan.name} sem carência se a inclusão for feita até ${d(deadline)}; ` +
          `o custo adicional é ${money(plan.dependent_cost)} por mês.`,
        proposal: {
          summary: `Incluir o recém-nascido no ${plan.name}`,
          details,
          args: { birth_date: toISO(birth), name: args.name },
        },
      };
    },
  },
  {
    name: 'benefits_daycare_info',
    action: 'self.benefits.read',
    params: {},
    handler: (ctx): ToolResult => {
      const rule = (ctx.services.companyPolicies().benefits as Record<string, Record<string, unknown>>).daycare as Record<
        string,
        number | string
      >;
      const deps = ctx.hr().benefits.dependents(ctx.identity.employeeId);
      const limitDays = Number(rule.max_age_months) * 30.44;
      const kids = deps.filter((x) => x.relationship === 'filho(a)' && diffDays(ctx.today, x.birth_date) < limitDays);
      const data = {
        title: 'Auxílio-creche',
        items: [
          { label: 'Valor', value: `${money(rule.monthly_per_child as number)} por mês, por filho` },
          { label: 'Idade', value: `até ${rule.max_age_months} meses (6 anos)` },
          { label: 'Comprovação', value: String(rule.requires) },
          { label: 'Filhos elegíveis hoje', value: String(kids.length) },
        ],
        eligible_children: kids.length,
        monthly_per_child: rule.monthly_per_child,
      };
      let summary =
        `O auxílio-creche é de ${money(rule.monthly_per_child as number)} por mês para cada filho de até ${rule.max_age_months} meses, ` +
        `mediante ${rule.requires}.`;
      summary += kids.length
        ? ` Hoje você tem ${plural(kids.length, 'filho elegível', 'filhos elegíveis')}.`
        : ' Assim que o dependente estiver cadastrado, você pode pedir.';
      return { data, summary, card: { type: 'kv', data } };
    },
  },
];

export { ZERO, gte };
