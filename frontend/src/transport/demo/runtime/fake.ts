/** Deterministic, scriptable stand-in for an LLM (`atrium.runtime.llm.fake`).
 *
 *  It walks the same orchestration path as a real model: answers the routing tool call, emits
 *  tool calls for specialists (choosing by catalog hints and extracting arguments with the
 *  NLU), and writes the final answer from the tools' deterministic summaries. */
import type { Day } from '../core/date';
import { fold } from '../core/text';
import type { ToolMeta } from '../data/types';
import * as nlu from './nlu';
import { stripWrapper } from '../guardrails/injection';

export const POLICY_CUES = [
  'posso', 'pode', 'como funciona', 'politica', 'regra', 'qual o limite', 'quantos dias preciso', 'e permitido',
  'o que diz', 'o que acontece', 'quem pode', 'existe', 'como peco', 'como solicito', 'o que fazer', 'qual o padrao',
  'qual o prefixo', 'como configurar', 'o que e', 'quando e', 'quando cai', 'prazo',
];

export const SMALL_TALK = [
  'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'obrigado', 'obrigada', 'valeu', 'o que voce faz',
  'quem e voce', 'o que voce consegue',
];

export const FALLBACKS: Record<string, string> = {
  vacation_request: 'vacation_suggest_windows',
  team_decide_vacation: 'team_pending_approvals',
  team_member_vacation: 'team_overview',
  reimbursement_submit: 'reimbursement_list',
  vacation_cancel_request: 'vacation_list_requests',
  benefits_change_plan: 'benefits_compare_plans',
  time_request_adjustment: 'time_get_bank',
  onboarding_complete_task: 'onboarding_checklist',
  profile_update_address: 'profile_get',
  profile_update_bank_account: 'profile_get',
  profile_add_dependent: 'profile_get',
  documents_visa_letter: 'kb_search',
  leave_register: 'kb_search',
  benefits_enroll_newborn: 'benefits_get_summary',
  reimbursement_extract_receipt: 'reimbursement_list',
};

const PLANS: Record<string, string> = {
  premium: 'Vitalis Premium',
  plus: 'Vitalis Plus',
  essencial: 'Vitalis Essencial',
  'odonto plus': 'Sorriso Odonto Plus',
  'odonto basico': 'Sorriso Odonto Básico',
};

const METRIC_WORDS: [string, string[]][] = [
  ['turnover', ['turnover', 'rotatividade', 'desligamento']],
  ['absenteeism', ['absenteismo', 'ausencia', 'faltas', 'atestado']],
  ['vacation_overdue', ['ferias vencid', 'ferias a vencer', 'ferias vencendo']],
  ['time_bank', ['banco de horas', 'horas extras']],
  ['headcount', ['headcount', 'quantas pessoas', 'quadro']],
];

export function scoreTool(text: string, name: string, catalog: Record<string, ToolMeta>): number {
  const meta = catalog[name];
  const f = fold(text);
  let s = 0;
  for (const h of meta?.hints ?? []) {
    if (nlu.containsPhrase(f, h)) s += 2.0 + 0.5 * (h.split(' ').length - 1);
  }
  const title = new Set(nlu.tokens(meta?.title ?? ''));
  const textTokens = new Set(nlu.tokens(text));
  let overlap = 0;
  for (const t of title) if (textTokens.has(t)) overlap += 1;
  return s + 0.5 * overlap;
}

export function selectTools(text: string, names: string[], catalog: Record<string, ToolMeta>): string[] {
  const scored = names
    .filter((n) => n !== 'kb_search')
    .map((n) => [scoreTool(text, n, catalog), n] as [number, string])
    .sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const f = fold(text);
  const policyQuestion = POLICY_CUES.some((c) => nlu.containsPhrase(f, c));
  if (!scored.length || scored[0][0] < 2.0) {
    if (SMALL_TALK.some((g) => nlu.containsPhrase(f, g)) && nlu.tokens(text).length <= 4) return [];
    return names.includes('kb_search') ? ['kb_search'] : [];
  }
  const top = scored[0][0];
  if (policyQuestion && top < 3.0 && names.includes('kb_search')) return ['kb_search'];
  const picks = scored.filter(([s]) => s >= 2.0 && s >= 0.3 * top).slice(0, 3).map(([, n]) => n);
  return picks.length ? picks : [scored[0][1]];
}

export interface TargetHint {
  name: string;
  action: string;
}

/** Arguments for a tool from the user's words. `null` when a required field is missing. */
export function extractArgs(
  name: string,
  text: string,
  today: Day,
  attachments: { upload_id: string; filename: string }[],
  target: TargetHint | null = null,
): Record<string, unknown> | null {
  const f = fold(text);
  const dates = nlu.parseDates(text, today);
  const days = nlu.parseDays(text);
  const iso = (d: Day): string => d.toISOString().slice(0, 10);
  if (name === 'kb_search') return { query: text.slice(0, 300) };
  if (name === 'vacation_suggest_windows') return days && days >= 5 && days <= 30 ? { days } : {};
  if (name === 'vacation_holiday_calendar') {
    const y = nlu.parseYear(text);
    return y ? { year: y } : {};
  }
  if (name === 'vacation_simulate') {
    const sell = nlu.parseSellDays(text);
    const restDays = nlu.parseDays(fold(text).replace(new RegExp(nlu.SELL_RE.source, 'g'), ' '));
    return {
      days: restDays && restDays >= 5 ? restDays : 30 - sell,
      sell_days: sell,
      advance_13th: f.includes('13') || f.includes('decimo'),
    };
  }
  if (name === 'vacation_request') {
    if (!dates.length) return null;
    const start = dates[0];
    const n =
      dates.length > 1 && dates[1].getTime() > start.getTime()
        ? Math.round((dates[1].getTime() - start.getTime()) / 86400000) + 1
        : days;
    if (!n) return null;
    return { start: iso(start), days: n, sell_days: nlu.parseSellDays(text), advance_13th: f.includes('13') };
  }
  if (name === 'vacation_cancel_request') {
    const rid = nlu.parseRequestId(text);
    return rid ? { request_id: rid } : null;
  }
  if (name === 'leave_register') {
    const kind = ['paternidade', 'maternidade', 'casamento', 'luto', 'adocao'].find((k) => f.includes(k));
    return kind ? { kind, start: iso(dates.length ? dates[0] : today) } : null;
  }
  if (name === 'payroll_get_payslip') {
    const out: Record<string, unknown> = f.includes('plr') ? { kind: 'plr' } : {};
    const m = nlu.parseMonth(text, today);
    if (m) out.month = m;
    return out;
  }
  if (name === 'payroll_annual_projection') return {};
  if (name === 'payroll_simulate_net') {
    const amount = nlu.parseAmount(text);
    return amount ? { gross: amount } : {};
  }
  if (name === 'payroll_simulate_pgbl') {
    const p = nlu.parsePercent(text);
    return p !== null && p <= 12 ? { contribution_percent: p } : {};
  }
  if (name === 'benefits_compare_plans') {
    return { kind: ['odonto', 'dentario', 'dentista'].some((w) => f.includes(w)) ? 'dental' : 'health' };
  }
  if (name === 'benefits_change_plan') {
    const entry = Object.entries(PLANS).find(([k]) => f.includes(k));
    return entry ? { plan: entry[1] } : null;
  }
  if (name === 'benefits_enroll_newborn') return { birth_date: iso(dates.length ? dates[0] : today) };
  if (name === 'reimbursement_extract_receipt') {
    const up = attachments.length ? attachments[0].upload_id : nlu.parseUuid(text);
    return up ? { upload_id: up } : null;
  }
  if (name === 'reimbursement_submit') return null;
  if (name === 'time_request_adjustment') {
    const t = nlu.parseTime(text);
    if (!t) return null;
    const kind = f.includes('entrada') || f.includes('cheguei') ? 'entrada' : 'saída';
    return {
      date: iso(dates.length ? dates[0] : today),
      time: t,
      kind,
      reason: 'esqueci de registrar a marcação',
    };
  }
  if (name === 'documents_employment_letter') {
    const purpose = f.includes('banco') ? 'banco' : f.includes('aluguel') ? 'aluguel' : 'comprovação de vínculo';
    return { purpose };
  }
  if (name === 'documents_visa_letter') {
    if (dates.length < 2) return null;
    const countries = ['Estados Unidos', 'Canadá', 'Portugal', 'França', 'Japão', 'Reino Unido', 'Alemanha'];
    const country = countries.find((c) => f.includes(fold(c))) ?? 'Estados Unidos';
    return { country, start: iso(dates[0]), end: iso(dates[1]) };
  }
  if (name === 'documents_income_statement') {
    const y = nlu.parseYear(text);
    return y ? { year: y } : {};
  }
  if (name === 'onboarding_complete_task') {
    const m = /\bONB-\d{2}\b/.exec(text.toUpperCase());
    return m ? { task_id: m[0] } : null;
  }
  if (name === 'team_decide_vacation') {
    const rid = nlu.parseRequestId(text);
    if (!rid) return null;
    const reject = ['recus', 'negar', 'nego', 'rejeit'].some((w) => f.includes(w));
    return { request_id: rid, decision: reject ? 'reject' : 'approve', note: '' };
  }
  if (name === 'team_member_vacation' || name === 'team_member_compensation') {
    const person = target?.name ?? nlu.parsePerson(text);
    return person ? { colleague: person } : null;
  }
  if (name === 'analytics_query') {
    const metric = METRIC_WORDS.find(([, ws]) => ws.some((w) => f.includes(w)))?.[0] ?? 'headcount';
    const group = f.includes('tempo de casa')
      ? 'tenure'
      : f.includes('modelo de trabalho') || f.includes('remoto')
        ? 'work_mode'
        : 'unit';
    return { metric, group_by: group };
  }
  if (name === 'ticket_open') return { category: 'Atendimento de Pessoas', summary: text.slice(0, 380) };
  if (['profile_update_address', 'profile_update_bank_account', 'profile_add_dependent'].includes(name)) return null;
  return {};
}

export interface FakeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export function countTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function specialistCalls(
  text: string,
  names: string[],
  catalog: Record<string, ToolMeta>,
  today: Day,
  attachments: { upload_id: string; filename: string }[],
  target: TargetHint | null,
): FakeToolCall[] {
  let picks = selectTools(text, names, catalog);
  if (target) {
    const targeted: Record<string, string> = {
      'team.vacation.read': 'team_member_vacation',
      'team.compensation.read': 'team_member_compensation',
      'team.time.read': 'team_overview',
    };
    const tool = targeted[target.action];
    if (tool && names.includes(tool)) picks = [tool];
  }
  picks = picks.slice().sort((a, b) => names.indexOf(a) - names.indexOf(b));
  const calls: FakeToolCall[] = [];
  for (let name of picks) {
    let args = extractArgs(name, text, today, attachments, target);
    const fallback = FALLBACKS[name];
    if (args === null && fallback && names.includes(fallback)) {
      name = fallback;
      args = extractArgs(fallback, text, today, attachments, target);
    }
    if (args !== null && calls.every((c) => c.name !== name)) {
      calls.push({ id: `call_${Math.random().toString(16).slice(2, 10)}`, name, arguments: args });
    }
  }
  return calls;
}

export function answerFromResults(results: { content: string }[]): string {
  const parts: string[] = [];
  let proposal = false;
  for (const m of results) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(stripWrapper(m.content)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (payload.summary) parts.push(String(payload.summary));
    proposal = proposal || payload.proposal_status === 'awaiting_user_confirmation';
  }
  let text = parts.join(' ') || 'Não consegui obter essa informação agora.';
  if (proposal && !fold(text).includes('confirm')) text += ' Revise os detalhes e confirme no cartão.';
  return text;
}

export function noToolAnswer(userText: string, first: string): string {
  const f = fold(userText);
  if (['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem'].some((g) => nlu.containsPhrase(f, g))) {
    return (
      `Olá, ${first}! Sou o assistente corporativo. Posso ajudar com férias, folha e holerite, benefícios, reembolsos, ` +
      'ponto, documentos, cadastro, carreira e políticas da empresa. O que você precisa?'
    );
  }
  if (['obrigado', 'obrigada', 'valeu'].some((g) => nlu.containsPhrase(f, g))) {
    return 'Por nada! Se precisar de mais alguma coisa, é só chamar.';
  }
  if (['o que voce faz', 'quem e voce', 'o que voce consegue'].some((g) => nlu.containsPhrase(f, g))) {
    return (
      'Eu sou a porta de entrada para os serviços da empresa: consulto e simulo seus dados (férias, salário, benefícios, ponto), ' +
      'explico políticas com citação das fontes e preparo pedidos que você confirma. Tudo com seus dados protegidos.'
    );
  }
  return (
    'Ainda não sei responder isso com segurança. Posso abrir um chamado para o time responsável, ' +
    'ou você pode perguntar sobre férias, holerite, benefícios, reembolsos, ponto, documentos ou carreira.'
  );
}

export function composeText(sections: [string, string][], intro: string | null): string {
  const header = intro ?? 'Reuni as respostas dos especialistas:';
  const body = sections
    .filter(([, text]) => text)
    .map(([name, text]) => `**${name}.** ${text}`)
    .join('\n\n');
  return `${header}\n\n${body}`;
}
