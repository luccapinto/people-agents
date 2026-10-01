/** Vacation and leave tools (agent: Férias e Ausências). */
import {
  type Day,
  addDays,
  day,
  dayOf,
  diffDays,
  fromISO,
  gt,
  gte,
  lt,
  lte,
  month,
  toISO,
  year,
} from '../core/date';
import { type Decimal, f } from '../core/money';
import { type HolidayDict, holidayDict, holidays } from '../calc/holidays';
import { type VacationPayResult, vacationPay } from '../calc/payroll';
import {
  type Fraction,
  type Issue,
  type Window,
  MIN_FRACTION,
  PeriodState,
  bestWindows,
  fractionIssues,
  planBalance,
  planDict,
  validateRequest,
  windowDict,
  windowEnd,
} from '../calc/vacation';
import type { VacationPeriodRow, VacationRequestRow } from '../data/store';
import type { ToolDef } from '../runtime/registry';
import { type ToolContext, ToolError, type ToolResult, fail } from '../runtime/tool';
import { currentSalary, d, dm, hmapFor, irDependents, money, nextWorkingDay, plural } from './util';

const ACTIVE = ['taken', 'approved', 'pending_manager'];

const MONTH_NAMES = [
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

/** The next occurrence of a month (this year, or next year if it already passed). */
function monthSpan(wanted: number, today: Day): [Day, Day] {
  const y = wanted >= month(today) ? year(today) : year(today) + 1;
  const nxt = day(y + (wanted === 12 ? 1 : 0), (wanted % 12) + 1, 1);
  return [day(y, wanted, 1), addDays(nxt, -1)];
}

function noWindowReason(wanted: number, today: Day, earliest: Day, latest: Day, notice: number, shortest: number): string {
  const [first, last] = monthSpan(wanted, today);
  const name = MONTH_NAMES[wanted - 1];
  let why: string;
  if (lt(last, earliest)) {
    why = `o pedido precisa de ${notice} dias de antecedência`;
  } else if (gt(first, latest) || gt(addDays(gte(first, earliest) ? first : earliest, shortest - 1), latest)) {
    why = `o saldo deste período precisa ser usado até ${d(latest)}`;
  } else {
    why = 'nenhum período que começa nesse mês respeita as regras da CLT para o seu saldo';
  }
  return `Em ${name} não há janela válida: ${why}. As janelas válidas mais próximas são estas. `;
}

export interface StateRow {
  id: string;
  status: string;
  label: string;
  acquisition_start: string;
  acquisition_end: string;
  concession_end: string;
  entitled_days: number;
  taken_days: number;
  scheduled_days: number;
  pending_days: number;
  sold_days: number;
  balance_days: number;
  days_to_deadline: number;
  risk: string;
  fractions_used: number;
  has_main_fraction: boolean;
}

/** Merge periods with requests into balance rows (used by self and manager tools). */
export function buildStates(periods: VacationPeriodRow[], requests: VacationRequestRow[], today: Day): StateRow[] {
  const rows: StateRow[] = [];
  for (const p of periods) {
    const reqs = requests.filter((r) => r.period_id === p.id && ACTIVE.includes(r.status));
    const fractions: Fraction[] = reqs.map((r) => ({ start: r.start, days: r.days }));
    const sold = reqs.reduce((sum, r) => sum + r.sell_days, 0);
    let entitled: number;
    if (p.status === 'accruing') {
      let months = 0;
      let probe = p.acquisition_start;
      for (;;) {
        const nxt = day(
          year(probe) + (month(probe) === 12 ? 1 : 0),
          (month(probe) % 12) + 1,
          Math.min(dayOf(probe), 28),
        );
        if (gt(nxt, today)) break;
        months += 1;
        probe = nxt;
      }
      entitled = Math.min(30, Math.floor((months * 5) / 2));
    } else {
      entitled = p.entitled_days;
    }
    const state = new PeriodState(p.acquisition_start, p.acquisition_end, entitled, fractions, sold);
    const taken = reqs
      .filter((r) => ['taken', 'approved'].includes(r.status) && lt(addDays(r.start, r.days - 1), today))
      .reduce((sum, r) => sum + r.days, 0);
    const scheduled = reqs
      .filter((r) => r.status === 'approved' && !lt(addDays(r.start, r.days - 1), today))
      .reduce((sum, r) => sum + r.days, 0);
    const pending = reqs.filter((r) => r.status === 'pending_manager').reduce((sum, r) => sum + r.days, 0);
    const daysLeft = diffDays(p.concession_end, today);
    const balance = p.status !== 'accruing' ? state.balance : 0;
    let risk = 'ok';
    if (p.status === 'open' && balance > 0) risk = daysLeft <= 60 ? 'critical' : daysLeft <= 120 ? 'attention' : 'ok';
    rows.push({
      id: p.id,
      status: p.status,
      label: `${year(p.acquisition_start)}/${year(p.acquisition_end)}`,
      acquisition_start: toISO(p.acquisition_start),
      acquisition_end: toISO(p.acquisition_end),
      concession_end: toISO(p.concession_end),
      entitled_days: entitled,
      taken_days: taken,
      scheduled_days: scheduled,
      pending_days: pending,
      sold_days: sold,
      balance_days: balance,
      days_to_deadline: daysLeft,
      risk,
      fractions_used: fractions.length,
      has_main_fraction: state.hasMainFraction,
    });
  }
  return rows;
}

function usableRow(rows: StateRow[]): StateRow | null {
  const open = rows.filter((r) => r.status === 'open' && r.balance_days >= MIN_FRACTION);
  if (!open.length) return null;
  return open.reduce((best, r) => (r.concession_end < best.concession_end ? r : best));
}

function stateFor(row: StateRow, requests: VacationRequestRow[]): PeriodState {
  const fractions: Fraction[] = requests
    .filter((r) => r.period_id === row.id && ACTIVE.includes(r.status))
    .map((r) => ({ start: r.start, days: r.days }));
  return new PeriodState(
    fromISO(row.acquisition_start),
    fromISO(row.acquisition_end),
    row.entitled_days,
    fractions,
    row.sold_days,
  );
}

export function lastVacationEnd(requests: VacationRequestRow[], today: Day): Day | null {
  const ends = requests
    .filter((r) => ['taken', 'approved'].includes(r.status) && lte(r.start, today))
    .map((r) => addDays(r.start, r.days - 1));
  if (!ends.length) return null;
  return ends.reduce((best, e) => (gt(e, best) ? e : best));
}

function payFor(ctx: ToolContext, days: number, sell: number, adv: boolean): [Decimal, VacationPayResult] {
  const hr = ctx.hr();
  const salary = currentSalary(hr.payroll.salaryHistory(ctx.identity.employeeId));
  const deps = irDependents(hr.benefits.dependents(ctx.identity.employeeId));
  return [salary, vacationPay(salary, days, sell, adv, deps, ctx.today)];
}

function validate(ctx: ToolContext, start: Day, days: number, sell: number): [StateRow, PeriodState, Issue[]] {
  const hr = ctx.hr();
  const periods = hr.vacation.periods(ctx.identity.employeeId);
  const requests = hr.vacation.requests(ctx.identity.employeeId);
  const rows = buildStates(periods, requests, ctx.today);
  const usable = usableRow(rows);
  if (usable === null) throw new ToolError('Você não tem saldo de férias disponível para solicitar agora.');
  const state = stateFor(usable, requests);
  return [usable, state, validateRequest(state, start, days, sell, hmapFor(ctx.today), ctx.today)];
}

function leaveDays(ctx: ToolContext, kind: string): [string, number] {
  const leave = ctx.services.companyPolicies().leave as Record<string, number | string>;
  if (kind === 'parental' || kind === 'adocao') {
    const privateRecord = ctx.hr().directory.private(ctx.identity.employeeId);
    if (privateRecord && privateRecord.sex === 'F') return ['licença-maternidade', Number(leave.maternity_days)];
    return ['licença-paternidade', Number(leave.paternity_days)];
  }
  const table: Record<string, [string, number]> = {
    paternidade: ['licença-paternidade', Number(leave.paternity_days)],
    maternidade: ['licença-maternidade', Number(leave.maternity_days)],
    casamento: ['licença casamento (gala)', Number(leave.marriage_days)],
    luto: ['licença nojo (luto)', Number(leave.bereavement_days)],
  };
  if (!(kind in table)) throw new ToolError('Tipo de licença desconhecido.');
  return table[kind];
}

export const vacationTools: ToolDef[] = [
  {
    name: 'vacation_get_balance',
    action: 'self.vacation.read',
    params: {},
    handler: (ctx): ToolResult => {
      const hr = ctx.hr();
      const periods = hr.vacation.periods(ctx.subjectId as string);
      const requests = hr.vacation.requests(ctx.subjectId as string);
      const rows = buildStates(periods, requests, ctx.today);
      const visible = rows.filter((r) => ['open', 'accruing'].includes(r.status));
      const available = visible.reduce((sum, r) => sum + r.balance_days, 0);
      const accruing = visible.find((r) => r.status === 'accruing') ?? null;
      const usable = usableRow(rows);
      const data = {
        available_days: available,
        periods: visible,
        accruing_days: accruing ? accruing.entitled_days : 0,
        next_deadline: usable ? usable.concession_end : null,
      };
      let summary: string;
      if (usable) {
        const dl = fromISO(usable.concession_end);
        summary =
          `Você tem ${plural(available, 'dia', 'dias')} de férias disponíveis. ` +
          `O período ${usable.label} precisa ser usado até ${d(dl)} (faltam ${usable.days_to_deadline} dias); ` +
          'depois disso os dias seriam pagos em dobro.';
      } else {
        summary = 'Você não tem saldo de férias disponível agora.';
      }
      if (accruing) {
        summary += ` No período em aquisição você já acumulou ${plural(accruing.entitled_days, 'dia', 'dias')}.`;
      }
      return { data, summary, card: { type: 'vacation_balance', data } };
    },
  },
  {
    name: 'vacation_holiday_calendar',
    action: 'none',
    params: { year: { type: 'int', optional: true, default: null, description: 'Ano (padrão: ano atual)' } },
    handler: (ctx, args): ToolResult => {
      const y = (args.year as number | null) ?? year(ctx.today);
      if (y < 2024 || y > 2030) throw new ToolError('Tenho o calendário de 2024 a 2030.');
      const items = holidays(y, ctx.identity.location).map((h) => ({
        ...holidayDict(h),
        weekday: (h.date.getUTCDay() + 6) % 7,
      }));
      const weekdays = items.filter((h) => h.weekday < 5);
      const data = { year: y, location: 'São Paulo, SP', holidays: items };
      return {
        data,
        summary:
          `Em ${y} a sede (São Paulo) tem ${items.length} feriados e pontos facultativos, ` +
          `${weekdays.length} deles em dias úteis.`,
        card: { type: 'holiday_calendar', data },
      };
    },
  },
  {
    name: 'vacation_suggest_windows',
    action: 'self.vacation.read',
    params: {
      days: { type: 'int', optional: true, default: null, ge: 5, le: 30, description: 'Quantidade de dias de férias desejada (opcional)' },
      month: { type: 'int', optional: true, default: null, ge: 1, le: 12, description: 'Mês desejado para o início (1 a 12, opcional)' },
    },
    handler: (ctx, args): ToolResult => {
      const hr = ctx.hr();
      const periods = hr.vacation.periods(ctx.subjectId as string);
      const requests = hr.vacation.requests(ctx.subjectId as string);
      const rows = buildStates(periods, requests, ctx.today);
      const usable = usableRow(rows);
      if (usable === null) {
        const accruing = rows.find((r) => r.status === 'accruing');
        const when = accruing ? d(addDays(fromISO(accruing.acquisition_end), 1)) : 'em breve';
        return fail(`Você ainda não tem saldo para tirar férias; o próximo período fica disponível em ${when}.`);
      }
      const hmap = hmapFor(ctx.today);
      const state = stateFor(usable, requests);
      const notice = Number((ctx.services.companyPolicies().vacation as Record<string, number>).notice_days);
      const earliest = addDays(ctx.today, notice);
      const limit = addDays(ctx.today, 365);
      const latest = lt(state.deadline, limit) ? state.deadline : limit;
      const balance = usable.balance_days;
      const wanted = args.days as number | null;
      if (wanted && wanted > balance) {
        throw new ToolError(`Você tem ${balance} dias disponíveis neste período; não dá para tirar ${wanted}.`);
      }
      const wantedMonth = args.month as number | null;
      // Only lengths the request would accept (CLT art. 134 §1): a suggestion must never be refused later.
      const valid = [...new Set([5, 7, 10, 14, 15, 20, balance])]
        .filter((n) => n >= MIN_FRACTION && n <= balance && !fractionIssues(state, n).length)
        .sort((a, b) => a - b);
      let note = '';
      let lengths: number[];
      if (wanted && valid.includes(wanted)) {
        lengths = [wanted];
      } else if (wanted) {
        const closest = [...valid].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a).slice(0, 1);
        if (!closest.length) throw new ToolError(fractionIssues(state, wanted)[0].message);
        lengths = closest;
        note =
          `Um período de ${wanted} dias não é possível agora: ${fractionIssues(state, wanted)[0].message} ` +
          `A opção mais próxima é de ${closest[0]} dias. `;
      } else {
        lengths = valid;
      }
      let windows: Window[];
      if (wantedMonth) {
        // The month on its own: a long window starting in the month before must not hide its starts.
        const [first, last] = monthSpan(wantedMonth, ctx.today);
        windows = bestWindows(lengths, hmap, gte(earliest, first) ? earliest : first, latest, state.fractions, 5, last);
        if (!windows.length) {
          // Never "posso sugerir outras datas" without suggesting them: say why, then show the nearest.
          note += noWindowReason(wantedMonth, ctx.today, earliest, latest, notice, Math.min(...lengths));
          const nearest = bestWindows(lengths, hmap, earliest, latest, state.fractions, 60);
          const away = (w: { start: Day }): number => Math.max(diffDays(first, w.start), diffDays(w.start, last), 0);
          windows = [...nearest]
            .sort((a, b) => away(a) - away(b) || b.restDays - a.restDays || a.start.getTime() - b.start.getTime())
            .slice(0, 3);
        }
      } else {
        windows = bestWindows(lengths, hmap, earliest, latest, state.fractions, 5);
      }
      const plans = wanted || wantedMonth ? [] : planBalance(state, hmap, earliest, latest);
      const hol: HolidayDict[] = [];
      for (let y = year(earliest); y <= year(latest); y += 1) {
        for (const h of holidays(y, ctx.identity.location)) {
          if (lte(earliest, h.date) && lte(h.date, latest)) hol.push(holidayDict(h));
        }
      }
      const data = {
        period: usable.label,
        balance_days: balance,
        deadline: toISO(state.deadline),
        earliest_start: toISO(earliest),
        latest_end: toISO(latest),
        windows: windows.map(windowDict),
        plans: plans.map(planDict),
        holidays: hol,
      };
      if (!windows.length) return fail('Não encontrei janelas válidas antes do fim do período concessivo.', data);
      const best = windows[0];
      let summary =
        note +
        `A janela mais eficiente é de ${dm(best.start)} a ${dm(windowEnd(best))}: ${plural(best.days, 'dia', 'dias')} de saldo ` +
        `rendem ${best.restDays} dias corridos de descanso`;
      summary += best.holidaysBridged.length ? `, emendando ${best.holidaysBridged.join(', ')}.` : '.';
      if (plans.length) {
        const p = plans[0];
        const parts = [...p.windows]
          .sort((a, b) => a.start.getTime() - b.start.getTime())
          .map((w) => `${w.days} dias a partir de ${dm(w.start)}`)
          .join(' + ');
        const restDays = p.windows.reduce((sum, w) => sum + w.restDays, 0);
        summary +=
          ` Para usar todos os ${balance} dias até ${d(state.deadline)}, o melhor plano é ${parts}, ` +
          `totalizando ${restDays} dias de descanso.`;
      }
      // Offer to request the best windows: a chip sends the dates as a new message, which becomes a
      // proposal the person confirms (never a request made on their behalf here).
      const chips = windows.slice(0, 2).map((w) => `Quero tirar férias de ${dm(w.start)} a ${dm(windowEnd(w))}`);
      return { data, summary, card: { type: 'vacation_calendar', data }, suggestions: chips };
    },
  },
  {
    name: 'vacation_simulate',
    action: 'self.vacation.read',
    params: {
      days: { type: 'int', ge: 5, le: 30, description: 'Dias de férias a tirar' },
      sell_days: { type: 'int', default: 0, ge: 0, le: 10, description: 'Dias a vender (abono pecuniário)' },
      advance_13th: { type: 'bool', default: false, description: 'Adiantar a 1ª parcela do 13º' },
    },
    handler: (ctx, args): ToolResult => {
      const days = args.days as number;
      const sell = args.sell_days as number;
      const [salary, r] = payFor(ctx, days, sell, args.advance_13th as boolean);
      const lines = r.lines.map((ln) => ({
        label: ln.label,
        value: ln.earning ?? ln.deduction,
        kind: ln.earning !== undefined ? 'earning' : 'deduction',
      }));
      const data = {
        title: `Simulação de férias (${days} dias)`,
        salary: f(salary),
        lines,
        gross: f(r.grossTotal),
        deductions: f(r.inss.plus(r.irrf)),
        net: f(r.netTotal),
        notes: [
          'Abono pecuniário e seu 1/3 não têm INSS nem IRRF.',
          'O pagamento ocorre até 2 dias antes do início das férias (CLT art. 145).',
          'Simulação com as tabelas oficiais de 2026; a folha pode ajustar o INSS no fechamento do mês.',
        ],
      };
      const summary =
        `Com ${days} dias de férias${sell ? ` e ${sell} dias vendidos` : ''}, ` +
        `o valor bruto estimado é ${money(r.grossTotal)} e o líquido ${money(r.netTotal)} ` +
        `(INSS ${money(r.inss)}, IRRF ${money(r.irrf)}).`;
      return { data, summary, card: { type: 'breakdown', data } };
    },
  },
  {
    name: 'vacation_request',
    action: 'self.vacation.request',
    params: {
      start: { type: 'date', description: 'Data de início (AAAA-MM-DD)' },
      days: { type: 'int', ge: 5, le: 30, description: 'Dias corridos de férias' },
      sell_days: { type: 'int', default: 0, ge: 0, le: 10, description: 'Dias a vender (abono)' },
      advance_13th: { type: 'bool', default: false, description: 'Adiantar 1ª parcela do 13º' },
    },
    executor: (ctx, args): ToolResult => {
      const start = fromISO(String(args.start));
      const [usable, , issues] = validate(ctx, start, args.days as number, args.sell_days as number);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) throw new ToolError(errors[0].message);
      const hr = ctx.hr();
      const req = hr.vacation.createRequest(
        ctx.identity.employeeId,
        usable.id,
        start,
        args.days as number,
        args.sell_days as number,
        args.advance_13th as boolean,
        ctx.today,
      );
      const manager = ctx.identity.managerId ? hr.directory.get(ctx.identity.managerId) : null;
      const who = manager ? manager.name : 'sua liderança';
      return {
        data: { request_id: req.id, status: req.status },
        summary: `Pedido ${req.id} registrado e enviado para aprovação de ${who}.`,
      };
    },
    handler: (ctx, args): ToolResult => {
      const start = args.start as Day;
      const days = args.days as number;
      const sell = args.sell_days as number;
      const [usable, , issues] = validate(ctx, start, days, sell);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) {
        const data = { issues, start: toISO(start), days };
        return fail(
          `Não dá para pedir essas datas: ${errors.map((i) => i.message).join(' ')}`,
          data,
          { type: 'validation', data },
        );
      }
      const end = addDays(start, days - 1);
      const back = nextWorkingDay(end, hmapFor(ctx.today));
      const [, pay] = payFor(ctx, days, sell, args.advance_13th as boolean);
      const details = [
        { label: 'Período de férias', value: `${d(start)} a ${d(end)} (${days} dias corridos)` },
        { label: 'Retorno', value: d(back) },
        { label: 'Período aquisitivo', value: usable.label },
        { label: 'Saldo após o pedido', value: plural(usable.balance_days - days - sell, 'dia', 'dias') },
        { label: 'Valor líquido estimado', value: money(pay.netTotal) },
      ];
      if (sell) details.splice(1, 0, { label: 'Abono pecuniário', value: plural(sell, 'dia vendido', 'dias vendidos') });
      for (const i of issues) details.push({ label: 'Atenção', value: i.message });
      return {
        data: { valid: true, end: toISO(end), return: toISO(back) },
        summary: `As datas são válidas. Preparei o pedido de ${d(start)} a ${d(end)} para você confirmar.`,
        proposal: {
          summary: `Solicitar férias de ${d(start)} a ${d(end)}`,
          details,
          args: { start: toISO(start), days, sell_days: sell, advance_13th: args.advance_13th },
        },
      };
    },
  },
  {
    name: 'vacation_list_requests',
    action: 'self.vacation.read',
    params: {},
    handler: (ctx): ToolResult => {
      const reqs = ctx.hr().vacation.requests(ctx.subjectId as string);
      const labels: Record<string, string> = {
        pending_manager: 'aguardando gestor',
        approved: 'aprovado',
        taken: 'gozado',
        rejected: 'recusado',
        cancelled: 'cancelado',
      };
      const recent = reqs.filter((r) => !lt(r.start, addDays(ctx.today, -400)));
      const rows = recent.map((r) => ({
        id: r.id,
        start: toISO(r.start),
        end: toISO(addDays(r.start, r.days - 1)),
        days: r.days,
        sell_days: r.sell_days,
        status: r.status,
        status_label: labels[r.status] ?? r.status,
      }));
      const pending = rows.filter((r) => r.status === 'pending_manager');
      let summary = `Você tem ${plural(rows.length, 'pedido', 'pedidos')} no último ano`;
      summary += pending.length ? `, ${plural(pending.length, 'aguardando', 'aguardando')} aprovação.` : '.';
      const data = {
        title: 'Meus pedidos de férias',
        columns: ['Início', 'Fim', 'Dias', 'Status'],
        rows: rows.map((r) => [r.start, r.end, r.days, r.status_label]),
        requests: rows,
      };
      return { data, summary, card: { type: 'table', data } };
    },
  },
  {
    name: 'vacation_cancel_request',
    action: 'self.vacation.request',
    params: { request_id: { type: 'str', description: 'Identificador do pedido (ex.: FER-50001)' } },
    executor: (ctx, args): ToolResult => {
      const hr = ctx.hr();
      const req = hr.vacation.getRequest(String(args.request_id));
      if (req === null || req.employee_id !== ctx.identity.employeeId) throw new ToolError('Pedido não encontrado.');
      hr.vacation.setStatus(req.id, 'cancelled', null, 'cancelado pela pessoa');
      return { data: { request_id: req.id, status: 'cancelled' }, summary: `Pedido ${req.id} cancelado.` };
    },
    handler: (ctx, args): ToolResult => {
      const req = ctx.hr().vacation.getRequest(String(args.request_id));
      if (req === null || req.employee_id !== ctx.identity.employeeId) {
        return fail('Não encontrei esse pedido entre os seus.');
      }
      if (!['pending_manager', 'approved'].includes(req.status) || lte(req.start, ctx.today)) {
        return fail('Só é possível cancelar pedidos pendentes ou aprovados que ainda não começaram.');
      }
      const end = addDays(req.start, req.days - 1);
      return {
        data: { request_id: req.id },
        summary: 'Preparei o cancelamento para você confirmar.',
        proposal: {
          summary: `Cancelar férias de ${d(req.start)} a ${d(end)}`,
          details: [
            { label: 'Pedido', value: req.id },
            { label: 'Dias devolvidos ao saldo', value: String(req.days) },
          ],
          args: { request_id: req.id },
        },
      };
    },
  },
  {
    name: 'leave_register',
    action: 'self.leave.request',
    params: {
      kind: { type: 'str', description: 'parental, paternidade, maternidade, casamento, luto ou adocao' },
      start: { type: 'date', description: 'Data de início (AAAA-MM-DD)' },
    },
    executor: (ctx, args): ToolResult => {
      const [label, days] = leaveDays(ctx, String(args.kind));
      const start = fromISO(String(args.start));
      const leave = ctx.hr().vacation.createLeave(ctx.identity.employeeId, label, start, days, 'registrada pelo assistente');
      const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
      return {
        data: { leave_id: leave.id },
        summary: `${capitalized} registrada (${leave.id}). O DP vai pedir a certidão.`,
      };
    },
    handler: (ctx, args): ToolResult => {
      const [label, days] = leaveDays(ctx, String(args.kind));
      const start = args.start as Day;
      const end = addDays(start, days - 1);
      const leave = ctx.services.companyPolicies().leave as Record<string, string>;
      const details = [
        { label: 'Licença', value: label },
        { label: 'Período', value: `${d(start)} a ${d(end)} (${days} dias corridos)` },
        { label: 'Documento', value: leave.documents },
      ];
      if (label.includes('paternidade')) {
        details.push({ label: 'Base', value: '5 dias legais (2026) + 15 do Programa Empresa Cidadã' });
      }
      const data = { kind: label, start: toISO(start), end: toISO(end), days };
      return {
        data,
        summary: `Você tem direito a ${days} dias de ${label}, de ${d(start)} a ${d(end)}.`,
        card: { type: 'leave', data },
        proposal: {
          summary: `Registrar ${label} a partir de ${d(start)}`,
          details,
          args: { kind: args.kind, start: toISO(start) },
        },
      };
    },
  },
];
