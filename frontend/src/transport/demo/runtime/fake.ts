/** Deterministic, scriptable stand-in for an LLM (`atrium.runtime.llm.fake`).
 *
 *  It walks the same orchestration path as a real model: answers the routing tool call, emits
 *  tool calls for specialists (choosing by catalog hints and extracting arguments with the
 *  NLU), and writes the final answer from the tools' deterministic summaries. */
import type { Day } from '../core/date';
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import type { ToolMeta } from '../data/types';
import * as nlu from './nlu';
import { expand } from './router';
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
  reimbursement_submit: 'reimbursement_guide',
  vacation_cancel_request: 'vacation_list_requests',
  time_request_adjustment: 'time_get_bank',
  onboarding_complete_task: 'onboarding_checklist',
  profile_update_address: 'profile_get',
  profile_update_bank_account: 'profile_get',
  profile_add_dependent: 'profile_get',
  documents_visa_letter: 'kb_search',
  leave_register: 'kb_search',
  benefits_enroll_newborn: 'benefits_get_summary',
  reimbursement_extract_receipt: 'reimbursement_guide',
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

// "Pode me mandar o holerite?" is a request, not a question about what is allowed.
const POLITE_REQUEST =
  /\b(pode|poderia|consegue|da para|da pra)\s+(me\s+)?(mandar|manda|enviar|envia|mostrar|mostra|passar|passa|gerar|emitir|ver|dar|baixar|trazer)\b|\bme\s+(manda|mostra|envia|passa)\b/;
const UPGRADE = /\b(upgrade|melhor plano|plano melhor|plano superior|subir de plano)\b/;
const DOWNGRADE = /\b(downgrade|plano mais barato|plano inferior|baixar de plano)\b/;
const VACATION_REQUEST = /\b(quero|vou|gostaria de|preciso|queria)\s+(tirar|marcar|pedir|agendar|solicitar)\b/;

export function policyQuestion(text: string): boolean {
  const f = fold(text);
  return !POLITE_REQUEST.test(f) && POLICY_CUES.some((c) => nlu.containsPhrase(f, c));
}

/** IDF of hint words across the tool catalog: "pgbl" says more than "salário". */
let rarityCache: { catalog: Record<string, ToolMeta>; rarity: Map<string, number> } | null = null;

function hintRarity(catalog: Record<string, ToolMeta>): Map<string, number> {
  if (rarityCache && rarityCache.catalog === catalog) return rarityCache.rarity;
  const df = new Map<string, number>();
  const entries = Object.values(catalog);
  for (const meta of entries) {
    const seen = new Set((meta.hints ?? []).flatMap((h) => nlu.contentWords(h)));
    for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const rarity = new Map<string, number>();
  for (const [w, c] of df) rarity.set(w, Math.log(1 + entries.length / c));
  rarityCache = { catalog, rarity };
  return rarity;
}

/** Hint phrases (exact, or all their content words in any order) plus title overlap. */
export function scoreTool(text: string, name: string, catalog: Record<string, ToolMeta>, expanded?: string): number {
  const meta = catalog[name];
  const n = expanded ?? nlu.normalize(text);
  const padded = ` ${n} `;
  const rarity = hintRarity(catalog);
  let s = 0;
  for (const h of meta?.hints ?? []) {
    const hintWords = nlu.contentWords(h);
    if (nlu.hasPhrase(n, h)) s += 2.0 + 0.5 * (h.split(' ').length - 1);
    else if (hintWords.length >= 2 && hintWords.every((w) => padded.includes(` ${w} `))) s += 1.0 + 0.75 * hintWords.length;
    else continue;
    s += 0.1 * Math.max(0, ...hintWords.map((w) => rarity.get(w) ?? 0));
  }
  const title = new Set(nlu.tokens(meta?.title ?? ''));
  const textTokens = new Set(nlu.tokens(n));
  let overlap = 0;
  for (const t of title) if (textTokens.has(t)) overlap += 1;
  return pyRound(s + 0.25 * overlap, 4);
}

/** One tool per ask: compound questions ("quanto vou receber e quanto valeria PGBL") are split
 *  into clauses and each clause gets its best tool; policy questions go to the knowledge base. */
export function selectTools(
  text: string,
  names: string[],
  catalog: Record<string, ToolMeta>,
  synonyms: Record<string, string[]> = {},
): string[] {
  const f = fold(text);
  if ((UPGRADE.test(f) || DOWNGRADE.test(f)) && names.includes('benefits_compare_plans')) {
    return ['benefits_compare_plans']; // compare first; the change is proposed on the result
  }
  const picks: string[] = [];
  for (const clause of nlu.clauses(text)) {
    const n = expand(clause, synonyms);
    const scored = names
      .filter((t) => t !== 'kb_search')
      .map((t) => [scoreTool(clause, t, catalog, n), t] as [number, string])
      .sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const top = scored.length ? scored[0][0] : 0;
    let pick: string;
    if (policyQuestion(clause) && (top < 3.0 || !nlu.firstPerson(clause)) && names.includes('kb_search')) {
      pick = 'kb_search'; // "como funciona o plano de saúde?" asks for the rule, not for my plan
    } else if (top >= 2.0) {
      pick = scored[0][1];
    } else {
      continue;
    }
    if (!picks.includes(pick)) picks.push(pick);
  }
  if (picks.length) return picks.slice(0, 4);
  // Small talk gets no tool; real questions fall back to the knowledge base.
  if (SMALL_TALK.some((g) => nlu.containsPhrase(f, g)) && nlu.tokens(text).length <= 4) return [];
  return names.includes('kb_search') ? ['kb_search'] : [];
}

/** The policy's names for expenses (`company_policies.yaml`, reimbursement.category_words and
 *  travel_words); the guide tool maps the described expense onto a category. */
export interface ExpenseWords {
  category_words: Record<string, string[]>;
  travel_words: string[];
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
  expense: ExpenseWords | null = null,
): Record<string, unknown> | null {
  const f = fold(text);
  const dates = nlu.parseDates(text, today);
  const days = nlu.parseDays(text);
  const iso = (d: Day): string => d.toISOString().slice(0, 10);
  if (name === 'kb_search') return { query: text.slice(0, 300) };
  if (name === 'vacation_suggest_windows') {
    const out: Record<string, unknown> = {};
    if (days && days >= 5 && days <= 30) out.days = days;
    const monthNumber = nlu.parseMonthNumber(text);
    if (monthNumber) out.month = monthNumber;
    return out;
  }
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
  if (name === 'reimbursement_guide') {
    // The expense as the person described it; the tool maps it onto the policy's categories.
    const words = Object.values(expense?.category_words ?? {}).flat();
    const word = words.find((w) => nlu.containsPhrase(f, w));
    const travel = (expense?.travel_words ?? []).find((w) => nlu.containsPhrase(f, w));
    if (!word) return {};
    return { category: travel && word !== travel ? `${word} ${travel}` : word };
  }
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
  synonyms: Record<string, string[]> = {},
  expense: ExpenseWords | null = null,
): FakeToolCall[] {
  let picks = selectTools(text, names, catalog, synonyms);
  // A file sent with the message is what the person wants read.
  if (attachments.length && names.includes('reimbursement_extract_receipt')) picks = ['reimbursement_extract_receipt'];
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
    let args = extractArgs(name, text, today, attachments, target, expense);
    const fallback = FALLBACKS[name];
    if (args === null && fallback && names.includes(fallback)) {
      name = fallback;
      args = extractArgs(fallback, text, today, attachments, target, expense);
    }
    if (args !== null && calls.every((c) => c.name !== name)) {
      calls.push({ id: `call_${Math.random().toString(16).slice(2, 10)}`, name, arguments: args });
    }
  }
  return calls;
}

/** A second step chained on a tool result, as a real model would: compare plans, then
 *  propose the change; find vacation windows, then propose the request. */
export function followUpCalls(
  done: { name: string; payload: Record<string, unknown> }[],
  names: string[],
  text: string,
): FakeToolCall[] {
  const f = fold(text);
  const out: FakeToolCall[] = [];
  const resultOf = (tool: string): Record<string, unknown> | undefined => done.find((r) => r.name === tool)?.payload;
  const compared = (resultOf('benefits_compare_plans')?.data ?? {}) as Record<string, unknown>;
  const plans = (compared.plans ?? []) as { name: string; current?: boolean }[];
  const direction = UPGRADE.test(f) ? 1 : DOWNGRADE.test(f) ? -1 : 0;
  if (plans.length && direction && names.includes('benefits_change_plan') && !resultOf('benefits_change_plan')) {
    const current = plans.findIndex((p) => p.current);
    if (current >= 0 && current + direction >= 0 && current + direction < plans.length) {
      out.push({
        id: `call_${Math.random().toString(16).slice(2, 10)}`,
        name: 'benefits_change_plan',
        arguments: { plan: plans[current + direction].name },
      });
    }
  }
  const suggested = (resultOf('vacation_suggest_windows')?.data ?? {}) as Record<string, unknown>;
  const windows = (suggested.windows ?? []) as { start: string; days: number }[];
  const constrained = nlu.parseMonthNumber(text) ?? nlu.parseDays(text);
  if (
    windows.length &&
    constrained &&
    VACATION_REQUEST.test(f) &&
    names.includes('vacation_request') &&
    !resultOf('vacation_request')
  ) {
    const best = windows[0];
    out.push({
      id: `call_${Math.random().toString(16).slice(2, 10)}`,
      name: 'vacation_request',
      arguments: { start: best.start, days: best.days, sell_days: nlu.parseSellDays(text), advance_13th: false },
    });
  }
  return out;
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
