/** People Analytics (agent: People Analytics). Aggregates only, with k-anonymity.
 *
 *  Groups with fewer than k people are suppressed; if a single group would be suppressed, the
 *  next smallest is suppressed too (complementary suppression). */
import { type Day, addDays, day, diffDays, firstOfMonth, gt, month, year } from '../core/date';
import { gfmt, pyRound } from '../core/money';
import { fold } from '../core/text';
import { unitSubtree } from '../authz/policy';
import { holidayMap, isNonWorking } from '../calc/holidays';
import type { EmployeeRow } from '../data/store';
import type { ToolDef } from '../runtime/registry';
import { ToolError, type ToolResult, fail } from '../runtime/tool';
import { buildStates } from './vacation';

const HRBP = ['hrbp'];

const METRICS: Record<string, [string, string]> = {
  headcount: ['Headcount', 'Pessoas ativas na data de hoje.'],
  turnover: ['Turnover (12 meses)', 'Desligamentos nos últimos 12 meses ÷ headcount médio do período.'],
  absenteeism: ['Absenteísmo (2026)', 'Dias de ausência ÷ dias úteis previstos de janeiro até o último mês fechado.'],
  vacation_overdue: ['Férias a vencer (90 dias)', 'Pessoas com saldo cujo período concessivo termina em até 90 dias.'],
  time_bank: ['Banco de horas médio', 'Média do saldo de banco de horas no último mês fechado, em horas.'],
};

function tenure(hire: Day, today: Day): string {
  const years = diffDays(today, hire) / 365.25;
  if (years < 1) return 'até 1 ano';
  if (years < 3) return '1 a 3 anos';
  if (years < 5) return '3 a 5 anos';
  return 'mais de 5 anos';
}

export interface AnalyticsGroup {
  group: string;
  value: number | null;
  n: number | null;
  suppressed: boolean;
  secondary?: boolean;
}

export function suppress(groups: AnalyticsGroup[], k: number): AnalyticsGroup[] {
  for (const g of groups) g.suppressed = (g.n ?? 0) < k;
  const hidden = groups.filter((g) => g.suppressed);
  if (hidden.length === 1) {
    const visible = groups
      .filter((g) => !g.suppressed)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
    if (visible.length) {
      visible[0].suppressed = true;
      visible[0].secondary = true;
    }
  }
  for (const g of groups) {
    if (g.suppressed) {
      g.value = null;
      g.n = null;
    }
  }
  return groups;
}

export const analyticsTools: ToolDef[] = [
  {
    name: 'analytics_query',
    action: 'analytics.aggregate',
    roles: HRBP,
    params: {
      metric: { type: 'str', description: 'headcount, turnover, absenteeism, vacation_overdue ou time_bank' },
      group_by: { type: 'str', default: 'unit', description: 'unit (área), tenure (tempo de casa) ou work_mode' },
      unit: { type: 'str', optional: true, default: null, description: 'Unidade (nome ou código)' },
    },
    handler: (ctx, args): ToolResult => {
      const metric = String(args.metric);
      const groupBy = String(args.group_by);
      if (!(metric in METRICS)) throw new ToolError(`Métricas disponíveis: ${Object.keys(METRICS).join(', ')}`);
      if (!['unit', 'tenure', 'work_mode'].includes(groupBy)) {
        throw new ToolError('Agrupe por área (unit), tempo de casa (tenure) ou modelo de trabalho (work_mode).');
      }
      const hr = ctx.hr();
      const units = hr.directory.units();
      const byId = new Map(units.map((u) => [u.id, u]));
      let scopeRoots = new Set(ctx.identity.hrbpUnits);
      if (args.unit) {
        const q = fold(String(args.unit));
        const match =
          units.find((u) => fold(u.id) === q || fold(u.name) === q) ?? units.find((u) => fold(u.name).includes(q)) ?? null;
        if (match === null) throw new ToolError(`Unidade “${args.unit}” não encontrada.`);
        scopeRoots = new Set([match.id]);
      }
      const scope = unitSubtree(units, scopeRoots);
      const decision = ctx.services.policy.authorize(ctx.identity, 'analytics.aggregate', null, {
        unitIds: [...scope].sort(),
        allUnits: units,
      });
      if (!decision.allowed) return { ...fail(decision.reason), decision };
      const k = ctx.services.policy.kAnonymity();
      const today = ctx.today;
      const people = hr.directory
        .byUnits([...scope].sort(), true)
        .filter((e) => e.id !== ctx.identity.employeeId);
      const activeIds = people.filter((e) => e.status === 'active').map((e) => e.id);
      const absences = metric === 'absenteeism' ? hr.time.absencesFor(activeIds) : [];
      const months = metric === 'time_bank' ? hr.time.monthsFor(activeIds) : [];
      const periods = metric === 'vacation_overdue' ? hr.vacation.periodsFor(activeIds) : [];
      const requests = metric === 'vacation_overdue' ? hr.vacation.requestsFor(activeIds) : [];

      const groupOf = (e: EmployeeRow): string => {
        if (groupBy === 'tenure') return tenure(e.hire_date, today);
        if (groupBy === 'work_mode') return e.work_mode;
        const chain = [e.unit_id];
        while (byId.get(chain[chain.length - 1])?.parent_id) {
          chain.push(byId.get(chain[chain.length - 1])!.parent_id as string);
        }
        const roots = [...scopeRoots].filter((r) => chain.includes(r));
        const root = roots.length ? roots[0] : chain[chain.length - 1];
        const idx = chain.indexOf(root);
        return idx > 0 ? (byId.get(chain[idx - 1])?.name ?? chain[idx - 1]) : (byId.get(root)?.name ?? root);
      };

      const buckets = new Map<string, { active: EmployeeRow[]; terminated: EmployeeRow[] }>();
      for (const e of people) {
        const key = groupOf(e);
        const bucket = buckets.get(key) ?? { active: [], terminated: [] };
        if (e.status === 'active') bucket.active.push(e);
        else if (e.termination_date && gt(e.termination_date, addDays(today, -365))) bucket.terminated.push(e);
        buckets.set(key, bucket);
      }

      const hmap = holidayMap([year(today)]);
      const lastClosed = addDays(firstOfMonth(today), -1);
      const jan1 = day(year(today), 1, 1);
      let workdays = 0;
      for (let i = 0; i <= diffDays(lastClosed, jan1); i += 1) {
        if (!isNonWorking(addDays(jan1, i), hmap)) workdays += 1;
      }
      const groups: AnalyticsGroup[] = [];
      for (const key of [...buckets.keys()].sort()) {
        const { active: act, terminated: term } = buckets.get(key)!;
        let n = act.length;
        let value: number;
        if (metric === 'headcount') {
          value = n;
        } else if (metric === 'turnover') {
          const avg = n + term.length / 2;
          value = avg ? pyRound((100 * term.length) / avg, 1) : 0;
          n = n + term.length;
        } else if (metric === 'absenteeism') {
          const ids = new Set(act.map((e) => e.id));
          const days = absences.filter((a) => ids.has(a.employee_id)).reduce((sum, a) => sum + a.days, 0);
          value = n ? pyRound((100 * days) / (workdays * n), 2) : 0;
        } else if (metric === 'vacation_overdue') {
          const ids = act.map((e) => e.id);
          value = 0;
          for (const eid of ids) {
            const rows = buildStates(
              periods.filter((p) => p.employee_id === eid),
              requests.filter((r) => r.employee_id === eid),
              today,
            );
            if (rows.some((r) => r.status === 'open' && r.balance_days > 0 && r.days_to_deadline <= 90)) value += 1;
          }
        } else {
          const ids = new Set(act.map((e) => e.id));
          const last = new Map<string, number>();
          for (const m of months) if (ids.has(m.employee_id)) last.set(m.employee_id, m.bank_balance_hours);
          const values = [...last.values()];
          value = values.length ? pyRound(values.reduce((a, b) => a + b, 0) / values.length, 1) : 0;
        }
        groups.push({ group: key, value, n, suppressed: false });
      }
      suppress(groups, k);
      const [label, definition] = METRICS[metric];
      const unitName =
        scopeRoots.size === 1 ? (byId.get([...scopeRoots][0])?.name ?? [...scopeRoots][0]) : 'escopo do HRBP';
      const unitSuffix = metric === 'turnover' || metric === 'absenteeism' ? '%' : metric === 'time_bank' ? 'h' : '';
      const data = {
        metric,
        label,
        definition,
        group_by: groupBy,
        unit: unitName,
        k,
        groups,
        suppressed_count: groups.filter((g) => g.suppressed).length,
        unit_suffix: unitSuffix,
      };
      const shown = groups.filter((g) => !g.suppressed);
      const fmt = (v: number): string =>
        unitSuffix === '%' ? `${gfmt(v)}%`.replace('.', ',') : gfmt(v).replace('.', ',');
      let summary = `${label} em ${unitName}: ${shown
        .map((g) => `${g.group} ${fmt(g.value as number)}${metric === 'time_bank' ? 'h' : ''}`)
        .join('; ')}.`;
      if (data.suppressed_count) {
        summary += ` ${data.suppressed_count} grupo(s) foram suprimidos por terem menos de ${k} pessoas (k-anonimato).`;
      }
      return { data, summary, card: { type: 'analytics', data }, decision };
    },
  },
];

export { month };
