/** Manager tools (agent: Liderança). Every team read is authorized per person by the policy
 *  engine; compensation stays hidden unless governance enables it. */
import { type Day, addDays, diffDays, fromISO, gte, month, replaceYear, toISO, year } from '../core/date';
import { gfmt } from '../core/money';
import type { Decision } from '../authz/policy';
import type { EmployeeRow } from '../data/store';
import type { ToolDef } from '../runtime/registry';
import { type ToolContext, type ToolResult, fail } from '../runtime/tool';
import { d, money, plural } from './util';
import { buildStates, lastVacationEnd } from './vacation';

const MANAGER = ['manager'];

function anniversary(hire: Day, today: Day): Day {
  const nxt = replaceYear(hire, year(today));
  return gte(nxt, today) ? nxt : replaceYear(nxt, year(today) + 1);
}

export interface TeamRow {
  id: string;
  name: string;
  title: string;
  hire_date: string;
  tenure_months: number;
  new_member: boolean;
  work_anniversary: string | null;
  anniversary_years: number;
  vacation_balance: number;
  vacation_deadline: string | null;
  vacation_risk: string;
  days_to_deadline: number | null;
  days_since_vacation: number | null;
  pending_requests: number;
  bank_hours: number;
  overtime_last_month: number;
  mandatory_pending: number;
}

export function teamRows(ctx: ToolContext): TeamRow[] {
  const me = ctx.identity;
  const hr = ctx.hr();
  const team = hr.directory
    .reports(me.employeeId)
    .filter((e) => ctx.services.policy.authorize(me, 'team.vacation.read', e.id).allowed);
  const ids = team.map((e) => e.id);
  const periods = hr.vacation.periodsFor(ids);
  const requests = hr.vacation.requestsFor(ids);
  const months = hr.time.monthsFor(ids);
  const trainings = hr.career.assignmentsFor(ids);
  const rows: TeamRow[] = [];
  for (const e of team) {
    const reqs = requests.filter((r) => r.employee_id === e.id);
    const states = buildStates(
      periods.filter((p) => p.employee_id === e.id),
      reqs,
      ctx.today,
    );
    const openRows = states.filter((s) => s.status === 'open' && s.balance_days > 0);
    const nearest = openRows.length
      ? openRows.reduce((best, s) => (s.concession_end < best.concession_end ? s : best))
      : null;
    const last = lastVacationEnd(reqs, ctx.today);
    const since = diffDays(ctx.today, last ?? e.hire_date);
    const tm = months.filter((m) => m.employee_id === e.id);
    const anniv = anniversary(e.hire_date, ctx.today);
    const years = year(anniv) - year(e.hire_date);
    rows.push({
      id: e.id,
      name: e.name,
      title: e.title,
      hire_date: toISO(e.hire_date),
      tenure_months: (year(ctx.today) - year(e.hire_date)) * 12 + month(ctx.today) - month(e.hire_date),
      new_member: diffDays(ctx.today, e.hire_date) <= 90,
      work_anniversary: diffDays(anniv, ctx.today) <= 30 && years > 0 ? toISO(anniv) : null,
      anniversary_years: years,
      vacation_balance: openRows.reduce((sum, s) => sum + s.balance_days, 0),
      vacation_deadline: nearest ? nearest.concession_end : null,
      vacation_risk: nearest ? nearest.risk : 'ok',
      days_to_deadline: nearest ? nearest.days_to_deadline : null,
      days_since_vacation: diffDays(ctx.today, e.hire_date) > 365 ? since : null,
      pending_requests: reqs.filter((r) => r.status === 'pending_manager').length,
      bank_hours: tm.length ? tm[tm.length - 1].bank_balance_hours : 0,
      overtime_last_month: tm.length ? tm[tm.length - 1].overtime_hours : 0,
      mandatory_pending: trainings.filter((t) => t.employee_id === e.id && t.status === 'pendente').length,
    });
  }
  return rows;
}

function resolveColleague(ctx: ToolContext, name: string): EmployeeRow | null {
  const hits = ctx.hr().directory.search(name, 10);
  const inChain = hits.filter((e) => ctx.identity.chainReports.includes(e.id));
  return (inChain.length ? inChain : hits)[0] ?? null;
}

function denied(decision: Decision): ToolResult {
  return { ...fail(decision.reason), decision };
}

export const leadershipTools: ToolDef[] = [
  {
    name: 'team_overview',
    action: 'team.vacation.read',
    roles: MANAGER,
    params: {},
    handler: (ctx): ToolResult => {
      const rows = teamRows(ctx);
      const expiring = rows.filter((r) => ['critical', 'attention'].includes(r.vacation_risk));
      const longGap = rows.filter((r) => (r.days_since_vacation ?? 0) > 365);
      const heavy = rows.filter((r) => r.overtime_last_month >= 12 || r.bank_hours >= 30);
      const pending = rows.reduce((sum, r) => sum + r.pending_requests, 0);
      const anniversaries = rows.filter((r) => r.work_anniversary);
      const data = {
        members: rows,
        highlights: {
          expiring: expiring.map((r) => r.name),
          long_without_vacation: longGap.map((r) => r.name),
          high_hours: heavy.map((r) => r.name),
          pending_approvals: pending,
          anniversaries: anniversaries.map((r) => r.name),
          new_members: rows.filter((r) => r.new_member).map((r) => r.name),
        },
        privacy_note: 'Remuneração do time não é exibida pela política de governança vigente.',
      };
      const parts = [`Seu time tem ${plural(rows.length, 'pessoa', 'pessoas')}.`];
      if (expiring.length) {
        parts.push(
          `Férias a vencer: ${expiring
            .map((r) => `${r.name} (${r.vacation_balance} dias até ${d(fromISO(r.vacation_deadline as string))})`)
            .join(', ')}.`,
        );
      }
      if (longGap.length) {
        parts.push(
          `Há mais de um ano sem férias: ${longGap.map((r) => `${r.name} (${r.days_since_vacation} dias)`).join(', ')}.`,
        );
      }
      if (heavy.length) {
        parts.push(
          `Carga de horas alta: ${heavy
            .map((r) => `${r.name} (${gfmt(r.overtime_last_month)}h extras, banco ${gfmt(r.bank_hours)}h)`)
            .join(', ')}.`,
        );
      }
      if (pending) {
        parts.push(
          `Você tem ${plural(pending, 'pedido de férias aguardando', 'pedidos de férias aguardando')} sua aprovação.`,
        );
      }
      if (anniversaries.length) {
        parts.push(
          `Aniversário de empresa nos próximos 30 dias: ${anniversaries
            .map((r) => `${r.name} (${r.anniversary_years} anos)`)
            .join(', ')}.`,
        );
      }
      return { data, summary: parts.join(' '), card: { type: 'team_table', data } };
    },
  },
  {
    name: 'team_pending_approvals',
    action: 'team.vacation.read',
    roles: MANAGER,
    params: {},
    handler: (ctx): ToolResult => {
      const hr = ctx.hr();
      const team = new Map(hr.directory.reports(ctx.identity.employeeId).map((e) => [e.id, e]));
      const reqs = hr.vacation.requestsFor([...team.keys()]).filter((r) => r.status === 'pending_manager');
      const items = reqs.map((r) => ({
        request_id: r.id,
        employee: team.get(r.employee_id)?.name ?? r.employee_id,
        employee_id: r.employee_id,
        start: toISO(r.start),
        end: toISO(addDays(r.start, r.days - 1)),
        days: r.days,
        sell_days: r.sell_days,
        requested_at: toISO(r.requested_at),
      }));
      const data = { items };
      if (!items.length) {
        return { data, summary: 'Não há pedidos de férias aguardando sua aprovação.', card: { type: 'approvals', data } };
      }
      const summary = `Pedidos aguardando você: ${items
        .map(
          (i) =>
            `${i.employee}, ${d(fromISO(i.start))} a ${d(fromISO(i.end))} (${i.days} dias, ${i.request_id})`,
        )
        .join('; ')}.`;
      return { data, summary, card: { type: 'approvals', data } };
    },
  },
  {
    name: 'team_decide_vacation',
    action: 'team.vacation.decide',
    roles: MANAGER,
    params: {
      request_id: { type: 'str', description: 'Pedido de férias (ex.: FER-00123)' },
      decision: { type: 'str', description: 'approve (aprovar) ou reject (recusar)' },
      note: { type: 'str', default: '', maxLength: 200, description: 'Comentário opcional' },
    },
    executor: (ctx, args): ToolResult => {
      const hr = ctx.hr();
      const req = hr.vacation.getRequest(String(args.request_id));
      if (req === null || req.status !== 'pending_manager') throw new Error('Pedido não está mais pendente.');
      const status = args.decision === 'approve' ? 'approved' : 'rejected';
      hr.vacation.setStatus(req.id, status, ctx.identity.employeeId, (args.note as string) || null);
      const who = hr.directory.get(req.employee_id);
      const verb = status === 'approved' ? 'aprovado' : 'recusado';
      return {
        data: { request_id: req.id, status },
        summary: `Pedido ${req.id} de ${who ? who.name : ''} ${verb}.`,
      };
    },
    handler: (ctx, args): ToolResult => {
      if (args.decision !== 'approve' && args.decision !== 'reject') {
        return fail('Decisão deve ser aprovar (approve) ou recusar (reject).');
      }
      const hr = ctx.hr();
      const req = hr.vacation.getRequest(String(args.request_id));
      const who = req ? hr.directory.get(req.employee_id) : null;
      if (req === null) return fail('Pedido não encontrado entre os do seu time.');
      ctx.subjectId = req.employee_id;
      const decision = ctx.services.policy.authorize(ctx.identity, 'team.vacation.decide', req.employee_id);
      if (!decision.allowed) return denied(decision);
      if (req.status !== 'pending_manager') return fail('Este pedido não está aguardando decisão.');
      const end = addDays(req.start, req.days - 1);
      const verb = args.decision === 'approve' ? 'Aprovar' : 'Recusar';
      const name = who ? who.name : '';
      return {
        data: { request_id: req.id },
        summary: `Preparei a decisão para você confirmar: ${verb.toLowerCase()} o pedido de ${name}.`,
        decision,
        proposal: {
          summary: `${verb} férias de ${name} (${d(req.start)} a ${d(end)})`,
          details: [
            { label: 'Pessoa', value: name },
            { label: 'Período', value: `${d(req.start)} a ${d(end)} (${req.days} dias)` },
            { label: 'Comentário', value: (args.note as string) || '-' },
          ],
          args: { request_id: args.request_id, decision: args.decision, note: args.note },
          subjectId: req.employee_id,
        },
      };
    },
  },
  {
    name: 'team_member_vacation',
    action: 'team.vacation.read',
    roles: MANAGER,
    params: { colleague: { type: 'str', description: 'Nome da pessoa do time' } },
    handler: (ctx, args): ToolResult => {
      const person = resolveColleague(ctx, String(args.colleague));
      if (person === null) return fail(`Não encontrei “${args.colleague}” no diretório.`);
      ctx.subjectId = person.id;
      const decision = ctx.services.policy.authorize(ctx.identity, 'team.vacation.read', person.id);
      if (!decision.allowed) return denied(decision);
      const hr = ctx.hr();
      const periods = hr.vacation.periods(person.id);
      const reqs = hr.vacation.requests(person.id);
      const rows = buildStates(periods, reqs, ctx.today).filter((r) => ['open', 'accruing'].includes(r.status));
      const available = rows.reduce((sum, r) => sum + r.balance_days, 0);
      const data: Record<string, unknown> = {
        person: person.name,
        available_days: available,
        periods: rows,
        accruing_days: rows.find((r) => r.status === 'accruing')?.entitled_days ?? 0,
        next_deadline: null,
      };
      const openRows = rows.filter((r) => r.status === 'open' && r.balance_days > 0);
      let summary = `${person.name} tem ${plural(available, 'dia', 'dias')} de férias disponíveis`;
      if (openRows.length) {
        const nearest = openRows.reduce((best, r) => (r.concession_end < best.concession_end ? r : best));
        data.next_deadline = nearest.concession_end;
        summary += `, com prazo até ${d(fromISO(nearest.concession_end))}`;
      }
      return { data, summary: `${summary}.`, card: { type: 'vacation_balance', data }, decision };
    },
  },
  {
    name: 'team_member_compensation',
    action: 'team.compensation.read',
    roles: MANAGER,
    params: { colleague: { type: 'str', description: 'Nome da pessoa do time' } },
    handler: (ctx, args): ToolResult => {
      const person = resolveColleague(ctx, String(args.colleague));
      if (person === null) return fail(`Não encontrei “${args.colleague}” no diretório.`);
      ctx.subjectId = person.id;
      const decision = ctx.services.policy.authorize(ctx.identity, 'team.compensation.read', person.id);
      if (!decision.allowed) return denied(decision);
      const history = ctx.hr().payroll.salaryHistory(person.id);
      if (!history.length) return fail('Sem dados de remuneração visíveis.');
      const current = history[history.length - 1];
      return {
        data: { person: person.name, salary: current.salary },
        summary: `O salário atual de ${person.name} é ${money(current.salary)} (política de governança permite).`,
        decision,
      };
    },
  },
];
