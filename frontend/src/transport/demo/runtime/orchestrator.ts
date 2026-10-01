/** The Concierge orchestrator: one chat turn, end to end, as a stream of events.
 *
 *  guardrails(in) → route (visible agents only) → specialists / life-event playbook →
 *  tools (validated, authorized, audited; writes become proposals) → composition →
 *  guardrails(out) → stream. Text is streamed only after the output guardrails passed. */
import { fromISO, toISO } from '../core/date';
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import { type IdentityContext, firstName, isManager, randomHex, rolesOf } from '../authz/identity';
import { type Evidence as EvidenceType, type GuardrailOutcome, type InputCheck, Evidence } from '../guardrails/pipeline';
import { wrapUntrusted } from '../guardrails/injection';
import type { AgentSpec } from './agents';
import { profileOf } from './agents';
import {
  type FakeToolCall,
  answerFromResults,
  composeText,
  countTokens,
  followUpCalls,
  noToolAnswer,
  specialistCalls,
} from './fake';
import * as nlu from './nlu';
import type { LiveConfig } from '@/lib/liveMode';
import { type LiveCompletion, type LiveMessage, liveComplete, toolSchema as liveToolSchema } from './live';
import { composePrompt, routerPrompt, specialistPrompt } from './prompts';
import { type Execution, allTools, execute, executionTrace } from './registry';
import { GENERAL_LABELS, LexicalRouter, type RouteDecision, decision as makeDecision, routeDict } from './router';
import type { Services } from './services';
import { ToolContext } from './tool';

export const MAX_STEPS = 5;
export const CHUNK = 28;
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{FE0F}\u{200D}]/gu;

const THIRD_PARTY_DOMAINS: [string, string, string[]][] = [
  [
    'team.compensation.read',
    'o salário ou o holerite',
    ['salario', 'holerite', 'contracheque', 'quanto ganha', 'remuneracao', 'plr', '13o', 'pagamento'],
  ],
  ['team.vacation.read', 'as férias', ['ferias', 'saldo de ferias', 'folga', 'licenca']],
  ['team.time.read', 'o banco de horas', ['banco de horas', 'horas extras', 'ponto']],
  [
    'other.personal.read',
    'os dados pessoais',
    ['cpf', 'endereco', 'conta bancaria', 'dependentes', 'plano de saude', 'telefone', 'avaliacao de desempenho'],
  ],
];

const GENERAL_ANSWER =
  'Esse é um pedido de uso geral ({label}). No produto, o Concierge responde esse tipo de pedido com o modelo de ' +
  'linguagem da empresa, passando pelos mesmos guardrails e pela mesma auditoria das outras conversas. Aqui não há ' +
  'modelo conectado, então não vou improvisar uma resposta nem citar um documento que não trata do assunto.';

export interface StreamEventOut {
  event: string;
  data: Record<string, unknown>;
}

function ev(type: string, data: Record<string, unknown>): StreamEventOut {
  return { event: type, data };
}

interface Usage {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

interface TurnState {
  identity: IdentityContext;
  conversationId: string;
  userText: string;
  attachments: { upload_id: string; filename: string }[];
  usage: Usage;
  evidence: EvidenceType;
  trace: {
    guardrails: GuardrailOutcome[];
    tools: Record<string, unknown>[];
    route: Record<string, unknown> | null;
    agents: string[];
    authz?: Record<string, unknown>;
  };
  cards: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  resolved: boolean;
  target: { name: string; action: string } | null;
  /** Specialists of the previous turn in this conversation. */
  previous: string[];
  suggestions: string[];
}

interface ThirdParty {
  subject: string;
  name: string;
  action: string;
  label: string;
  decision: { allowed: boolean; policy: string; reason: string };
}

export class Orchestrator {
  /** `live`: the visitor's OpenRouter key (demo live mode). Without it the deterministic model
   *  answers, exactly as in the parity suites. With it, the model routes, picks tool calls and
   *  writes text; tools, authorization, proposals and guardrails stay in this engine. */
  constructor(
    private readonly s: Services,
    private readonly streamDelayMs = 0,
    private readonly live: LiveConfig | null = null,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async *run(
    identity: IdentityContext,
    conversationId: string | null,
    text: string,
    attachments: { upload_id: string; filename: string }[] = [],
    playground: string | null = null,
  ): AsyncGenerator<StreamEventOut> {
    const me: IdentityContext = { ...identity, requestId: randomHex(16) };
    const [convId, isNew] = this.s.conversations.ensure(me.employeeId, conversationId, playground);
    const st: TurnState = {
      identity: me,
      conversationId: convId,
      userText: text.trim(),
      attachments,
      usage: { model: '', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 },
      evidence: new Evidence(),
      trace: { guardrails: [], tools: [], route: null, agents: [] },
      cards: [],
      citations: [],
      proposals: [],
      resolved: true,
      target: null,
      previous: [],
      suggestions: [],
    };
    if (!isNew) st.previous = this.s.conversations.lastAgents(me.employeeId, convId);
    yield ev('message.start', { conversation_id: convId, request_id: me.requestId });

    const limit = this.s.policy.store.value('user_rate_limit_per_minute', 12);
    if (this.s.conversations.recentUserMessages(me.employeeId) >= limit) {
      yield ev('error', {
        code: 'rate_limited',
        message: 'Muitas mensagens em pouco tempo. Aguarde um minuto e tente de novo.',
      });
      return;
    }
    if (this.s.conversations.tokensToday(me.employeeId) >= this.s.policy.store.value('user_daily_token_budget', 200000)) {
      yield ev('error', {
        code: 'budget_exceeded',
        message: 'Seu orçamento diário de uso do assistente acabou. Ele renova amanhã.',
      });
      return;
    }

    const check = this.s.guardrails.checkInput(st.userText);
    for (const o of check.outcomes) {
      st.trace.guardrails.push(o);
      yield ev('trace.guardrail', { ...o });
    }
    this.s.audit.append('guardrail.input', {
      actor: me.employeeId,
      conversation: convId,
      request: me.requestId,
      payload: { outcomes: check.outcomes.filter((o) => o.outcome !== 'pass') },
    });
    this.s.conversations.add(
      me.employeeId,
      convId,
      'user',
      check.storedText,
      { attachments: st.attachments },
      check.storedText !== st.userText,
    );
    if (isNew) {
      const title = check.sensitive ? 'Conversa sensível' : check.storedText.slice(0, 60) || 'Nova conversa';
      this.s.conversations.setTitle(me.employeeId, convId, title, Boolean(check.sensitive));
    }

    if (check.blocked) {
      yield* this.finish(st, check.message, []);
      return;
    }

    let visible = this.s.agents.visibleFor(me);
    if (playground) {
      const draft = this.s.agents.draftForOwner(playground, me);
      if (draft === null) {
        this.s.audit.append('authz.denied', {
          actor: me.employeeId,
          conversation: convId,
          payload: { action: 'studio.playground', agent: playground },
        });
        yield ev('error', { code: 'agent_unavailable', message: 'Este agente não está disponível para você.' });
        return;
      }
      visible = [...visible.filter((a) => a.id !== playground), draft];
    }
    if (check.sensitive) {
      yield* this.sensitive(st, check, visible);
      return;
    }

    const third = this.thirdParty(st);
    if (third && !third.decision.allowed) {
      yield* this.refuseThirdParty(st, third);
      return;
    }
    if (third && visible.some((a) => a.id === 'leadership')) {
      st.target = { name: third.name, action: third.action };
    }

    let routed: RouteDecision;
    if (st.target) {
      routed = makeDecision(
        'single',
        ['leadership'],
        `Pergunta sobre ${st.target.name}, do time da pessoa autenticada.`,
        { method: 'subject_check' },
      );
    } else {
      routed = this.live ? await this.liveRoute(st, visible, playground) : this.route(st, visible, playground);
    }
    const names = new Map(visible.map((a) => [a.id, a.name]));
    const routeData = routeDict(routed);
    st.trace.route = routeData as unknown as Record<string, unknown>;
    yield ev('trace.route', { ...routeData, agent_names: routed.agents.map((a) => names.get(a) ?? a) });
    this.s.audit.append('chat.route', {
      actor: me.employeeId,
      conversation: convId,
      request: me.requestId,
      payload: { mode: routed.mode, agents: routed.agents, method: routed.method },
    });

    if (routed.mode === 'clarify') {
      yield* this.finish(
        st,
        routed.clarification || 'Pode detalhar um pouco mais?',
        [],
        routed.suggestions.length ? routed.suggestions : routed.agents.map((a) => `Sobre ${names.get(a) ?? a}`),
      );
      return;
    }

    const byId = new Map(visible.map((a) => [a.id, a]));
    if (routed.mode === 'general') {
      const concierge = byId.get('concierge');
      if (this.live && concierge) {
        const answer = yield* this.specialist(st, concierge, false);
        yield* this.finish(st, answer, ['concierge']);
        return;
      }
      // No model connected: say so honestly instead of guessing or citing an unrelated document.
      const kind = routed.general || 'conhecimento geral';
      const label = GENERAL_LABELS[kind] ?? kind;
      const card = { type: 'general_request', data: { kind, label } };
      st.cards.push({ ...card, agent_id: 'concierge' });
      yield ev('card', { agent_id: 'concierge', card });
      yield* this.finish(st, GENERAL_ANSWER.replace('{label}', label), ['concierge']);
      return;
    }
    if (routed.mode === 'life_event' && routed.lifeEvent) {
      const sections = yield* this.playbook(st, routed.lifeEvent, byId);
      const event = this.s.lifeEvents()[routed.lifeEvent];
      const final = this.live ? await this.liveCompose(st, sections, event.intro) : this.compose(st, sections, event.intro);
      yield* this.finish(st, final, routed.agents);
      return;
    }

    const sections: [string, string][] = [];
    for (const agentId of routed.agents) {
      const agent = byId.get(agentId);
      if (!agent) {
        st.trace.guardrails.push({
          name: 'route_check',
          stage: 'route',
          outcome: 'block',
          detail: `agente ${agentId} não visível`,
        });
        continue;
      }
      const answer = yield* this.specialist(st, agent);
      sections.push([agent.name, answer]);
    }
    const final =
      sections.length === 1 ? sections[0][1] : this.live ? await this.liveCompose(st, sections, null) : this.compose(st, sections, null);
    yield* this.finish(st, final, routed.agents);
  }

  // ------------------------------------------------------------------ routing
  private route(st: TurnState, visible: AgentSpec[], playground: string | null): RouteDecision {
    if (playground) {
      return makeDecision('single', [playground], 'Modo playground do Agent Studio: agente fixo.', {
        method: 'playground',
      });
    }
    const ids = visible.map((a) => a.id);
    const router = new LexicalRouter(visible.map(profileOf), this.s.lifeEvents(), this.s.lexicon());
    const lexical = router.route(st.userText, ids, st.previous);
    if (lexical.mode === 'life_event') return { ...lexical, method: 'playbook' };
    // The fake model answers the routing tool call with exactly this lexical decision.
    this.addUsage(st, countTokens(st.userText) + 300, 40);
    if (lexical.mode === 'general') {
      return makeDecision('general', ['concierge'], lexical.reason, {
        general: lexical.general || 'conhecimento geral',
      });
    }
    const agents = lexical.agents.filter((a) => ids.includes(a)).slice(0, 3);
    const chosen = agents.length ? agents : ['concierge'];
    let mode = lexical.mode;
    if (mode === 'multi' && chosen.length < 2) mode = 'single';
    if (chosen.length === 1 && chosen[0] === 'concierge') mode = 'direct';
    return makeDecision(mode, chosen, lexical.reason, {
      method: 'lexical',
      scores: lexical.scores,
      clarification: lexical.clarification || null,
      suggestions: lexical.suggestions,
    });
  }

  private addUsage(st: TurnState, prompt: number, completion: number): void {
    st.usage.model = 'fake-deterministic';
    st.usage.prompt_tokens += prompt;
    st.usage.completion_tokens += completion;
  }

  // ------------------------------------------------------------------ live mode
  private async ask(st: TurnState, messages: LiveMessage[], tools?: Record<string, unknown>[], toolChoice?: unknown): Promise<LiveCompletion> {
    const c = await liveComplete(this.live!, messages, { tools, toolChoice }, this.fetchImpl);
    st.usage.model = c.model;
    st.usage.prompt_tokens += c.promptTokens;
    st.usage.completion_tokens += c.completionTokens;
    st.usage.cost_usd += c.costUsd;
    return c;
  }

  /** The model answers the same route_request call as the back-end's real-model path; life events
   *  are still detected first, and only agents visible to the person can be chosen. */
  private async liveRoute(st: TurnState, visible: AgentSpec[], playground: string | null): Promise<RouteDecision> {
    if (playground) return this.route(st, visible, playground);
    const ids = visible.map((a) => a.id);
    const lexical = new LexicalRouter(visible.map(profileOf), this.s.lifeEvents(), this.s.lexicon()).route(st.userText, ids, st.previous);
    if (lexical.mode === 'life_event') return { ...lexical, method: 'playbook' };
    const routeTool = {
      type: 'function',
      function: {
        name: 'route_request',
        description: 'Decide quais especialistas atendem a mensagem.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['agents', 'mode'],
          properties: {
            agents: { type: 'array', items: { type: 'string', enum: ids }, minItems: 1, maxItems: 3 },
            mode: { type: 'string', enum: ['single', 'multi', 'clarify', 'direct', 'general'] },
            life_event: { type: 'string', enum: ['none', 'birth', 'marriage', 'address_change'] },
            clarification: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    };
    const history = this.s.conversations.history(st.identity.employeeId, st.conversationId, 4).slice(0, -1);
    const c = await this.ask(
      st,
      [
        { role: 'system', content: routerPrompt(visible, this.s.today, this.s.branding) },
        ...history.map((m) => ({ role: m.role as LiveMessage['role'], content: m.content })),
        { role: 'user', content: st.userText },
      ],
      [routeTool],
      { type: 'function', function: { name: 'route_request' } },
    );
    const call = c.toolCalls.find((t) => t.name === 'route_request');
    if (!call) return makeDecision('direct', ['concierge'], 'Roteador não decidiu; Concierge responde.', { method: 'llm' });
    const args = call.arguments as { agents?: string[]; mode?: string; reason?: string; clarification?: string };
    const agents = (args.agents ?? []).filter((a) => ids.includes(a)).slice(0, 3);
    const chosen = agents.length ? agents : ['concierge'];
    let mode = args.mode ?? 'single';
    if (mode === 'general') return makeDecision('general', ['concierge'], args.reason ?? '', { method: 'llm', general: 'conhecimento geral' });
    if (mode === 'multi' && chosen.length < 2) mode = 'single';
    if (chosen.length === 1 && chosen[0] === 'concierge') mode = 'direct';
    return makeDecision(mode, chosen, args.reason ?? '', { method: 'llm', clarification: args.clarification || null });
  }

  private async liveCompose(st: TurnState, sections: [string, string][], intro: string | null): Promise<string> {
    const body = sections.map(([name, text]) => `[${name}]\n${text}`).join('\n\n');
    const c = await this.ask(st, [
      { role: 'system', content: composePrompt(st.identity, this.s.branding) },
      { role: 'user', content: `Pergunta: ${st.userText}\n\n${intro ? `${intro}\n\n` : ''}${body}` },
    ]);
    return c.content.trim() || body;
  }

  // ------------------------------------------------------------------ third-party subjects
  private thirdParty(st: TurnState): ThirdParty | null {
    const f = fold(st.userText);
    const domain = THIRD_PARTY_DOMAINS.find(([, , words]) => words.some((w) => nlu.containsPhrase(f, w)));
    if (!domain) return null;
    const names = this.s.directory();
    const firsts = new Map<string, string[]>();
    for (const [eid, name] of names) {
      const key = fold(name.split(/\s+/)[0]);
      firsts.set(key, [...(firsts.get(key) ?? []), eid]);
    }
    let person: string | null = null;
    for (const [eid, name] of names) {
      if (f.includes(fold(name)) && eid !== st.identity.employeeId) {
        person = eid;
        break;
      }
    }
    if (person === null) {
      for (const token of new Set(nlu.words(f))) {
        const ids = firsts.get(token) ?? [];
        const capitalized = token.charAt(0).toUpperCase() + token.slice(1);
        if (ids.length === 1 && ids[0] !== st.identity.employeeId && st.userText.includes(capitalized)) {
          person = ids[0];
          break;
        }
      }
    }
    if (person === null) return null;
    const [action, label] = domain;
    const decision = this.s.policy.authorize(st.identity, action, person);
    return { subject: person, name: names.get(person) as string, action, label, decision };
  }

  private async *refuseThirdParty(st: TurnState, third: ThirdParty): AsyncGenerator<StreamEventOut> {
    const dec = third.decision;
    const trace = { subject: third.subject, subject_name: third.name, action: third.action, decision: dec };
    st.trace.authz = trace;
    yield ev('trace.authz', { ...trace });
    this.s.audit.append('authz.denied', {
      actor: st.identity.employeeId,
      subject: third.subject,
      conversation: st.conversationId,
      request: st.identity.requestId,
      payload: { action: third.action, decision: dec, stage: 'subject_check' },
    });
    st.evidence.authorizedPeople.delete(third.name);
    let why: string;
    if (
      third.action === 'team.compensation.read' &&
      isManager(st.identity) &&
      st.identity.chainReports.includes(third.subject)
    ) {
      why = 'Pela política de governança vigente, gestores não veem salário nem holerite do time.';
    } else if (third.action === 'team.compensation.read') {
      why = 'Remuneração é um dado individual e confidencial: só a própria pessoa tem acesso.';
    } else if (third.action === 'other.personal.read') {
      why = 'Dados cadastrais e de benefícios são individuais: só a própria pessoa tem acesso.';
    } else {
      why = 'Esse dado só é visível para a própria pessoa e para a liderança dela.';
    }
    const text =
      `Não posso mostrar ${third.label} de ${third.name}. ${why} ` +
      'Essa regra é aplicada pelo sistema, não por mim, e vale para qualquer pedido. Posso ajudar com os seus próprios dados?';
    yield* this.finish(st, text, []);
  }

  // ------------------------------------------------------------------ specialists
  private async *specialist(st: TurnState, agent: AgentSpec, withTools = true): AsyncGenerator<StreamEventOut, string> {
    yield ev('agent.start', { agent_id: agent.id, agent_name: agent.name });
    st.trace.agents.push(agent.id);
    const tools = allTools();
    const roles = rolesOf(st.identity);
    const allowed = withTools
      ? agent.tools.filter((n) => n in tools && (!tools[n].roles.length || tools[n].roles.some((r) => roles.includes(r))))
      : [];
    const systemPrompt = specialistPrompt(
      agent,
      st.identity,
      this.s.today,
      this.s.branding,
      this.s.catalog.agents.common_rules,
    );
    const note = st.attachments.length
      ? `\n\nArquivos enviados nesta mensagem: ${st.attachments
          .map((a) => `${a.filename} (upload_id=${a.upload_id})`)
          .join('; ')}`
      : '';
    const history = this.s.conversations.history(st.identity.employeeId, st.conversationId, 6).slice(0, -1);
    const baseTokens =
      countTokens(systemPrompt) +
      history.reduce((sum, m) => sum + countTokens(m.content), 0) +
      countTokens(st.userText + note);
    const ctx = new ToolContext(st.identity, this.s, agent.id, st.conversationId, agent.knowledge);
    const summaries: string[] = [];
    const executions: Execution[] = [];
    const toolMessages: { content: string }[] = [];
    const done: { name: string; payload: Record<string, unknown> }[] = [];
    let answer = '';
    let promptTokens = baseTokens;

    if (this.live) {
      // The model proposes tool calls; each one is validated (no extra fields), authorized and,
      // for writes, turned into a proposal by the same execute() as the deterministic path.
      const schemas = allowed.map((n) => liveToolSchema(n, tools[n].description, tools[n].params));
      const messages: LiveMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role as LiveMessage['role'], content: m.content })),
        { role: 'user', content: st.userText + note },
      ];
      for (let step = 0; step < MAX_STEPS && !answer; step += 1) {
        const c = await this.ask(st, messages, schemas.length ? schemas : undefined);
        if (!c.toolCalls.length) {
          answer = c.content.trim();
          break;
        }
        messages.push({
          role: 'assistant',
          content: c.content || null,
          tool_calls: c.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: JSON.stringify(t.arguments) } })),
        });
        for (const call of c.toolCalls) {
          ctx.subjectId = null;
          const ex = execute(ctx, call.name, call.arguments, new Set(allowed));
          executions.push(ex);
          const payload = yield* this.emitExecution(st, ctx, agent, ex);
          summaries.push(ex.result.summary);
          messages.push({ role: 'tool', tool_call_id: call.id, content: wrapUntrusted(`tool:${call.name}`, JSON.stringify(payload)) });
        }
      }
    }

    for (let step = 0; step < MAX_STEPS && !this.live; step += 1) {
      let calls: FakeToolCall[];
      if (toolMessages.length) {
        calls = followUpCalls(done, allowed, st.userText);
        if (!calls.length) {
          this.addUsage(st, promptTokens, 120);
          answer = answerFromResults(toolMessages);
          break;
        }
        this.addUsage(st, promptTokens, 30);
      } else {
        if (!allowed.length) {
          this.addUsage(st, countTokens(st.userText) + 200, 60);
          answer = noToolAnswer(st.userText, firstName(st.identity));
          break;
        }
        calls = specialistCalls(
          st.userText,
          allowed,
          this.s.toolCatalog(),
          this.s.today,
          st.attachments,
          st.target,
          this.s.lexicon().synonyms ?? {},
        );
        if (!calls.length) {
          this.addUsage(st, countTokens(st.userText) + 200, 60);
          answer = noToolAnswer(st.userText, firstName(st.identity));
          break;
        }
        this.addUsage(st, promptTokens, 30 * calls.length);
      }
      for (const call of calls) {
        ctx.subjectId = null;
        const ex = execute(ctx, call.name, call.arguments, new Set(allowed));
        executions.push(ex);
        const payload = yield* this.emitExecution(st, ctx, agent, ex);
        summaries.push(ex.result.summary);
        const content = wrapUntrusted(`tool:${call.name}`, JSON.stringify(payload));
        toolMessages.push({ content });
        promptTokens += countTokens(content);
        done.push({ name: call.name, payload });
      }
    }
    if (!answer) answer = summaries.join(' ') || 'Não consegui concluir agora.';
    if (
      executions.length &&
      executions.every((e) => ['error', 'denied', 'invalid'].includes(e.status)) &&
      executions.every((e) => e.tool.name === 'kb_search')
    ) {
      st.resolved = false;
      this.s.conversations.recordUnanswered(st.identity.employeeId, agent.id, st.userText);
    }
    return answer;
  }

  private async *emitExecution(
    st: TurnState,
    ctx: ToolContext,
    agent: AgentSpec,
    ex: Execution,
  ): AsyncGenerator<StreamEventOut, Record<string, unknown>> {
    const trace = { ...executionTrace(ex), agent_id: agent.id };
    st.trace.tools.push(trace);
    yield ev('trace.tool', { ...trace });
    const r = ex.result;
    st.evidence.texts.push(r.summary);
    st.evidence.texts.push(JSON.stringify(r.data));
    if (ex.decision.allowed && ctx.subjectId) {
      const person = this.s.directoryName(ctx.subjectId);
      if (person) st.evidence.authorizedPeople.add(person);
    }
    if (r.card) {
      st.cards.push({ ...r.card, agent_id: agent.id });
      yield ev('card', { agent_id: agent.id, card: { type: r.card.type, data: r.card.data } });
    }
    for (const s of r.suggestions ?? []) if (!st.suggestions.includes(s)) st.suggestions.push(s);
    for (const cit of r.citations ?? []) {
      if (st.citations.every((c) => c.id !== cit.id)) {
        st.citations.push({ ...cit });
        st.evidence.texts.push(cit.snippet);
        yield ev('citation', { ...cit });
      }
    }
    const payload: Record<string, unknown> = {
      ok: !r.error && ex.status !== 'denied',
      summary: r.summary,
      data: r.data,
    };
    if (r.proposal && ex.status === 'proposal') {
      const target = allTools()[r.proposal.tool || ex.tool.name];
      const p = await this.s.proposals.create(ctx, target, r.proposal);
      const { token, ...publicProposal } = p;
      void token;
      st.proposals.push(publicProposal);
      yield ev('proposal', { ...p });
      payload.proposal_status = 'awaiting_user_confirmation';
      payload.note = 'Proposta criada. Só a pessoa pode confirmar, no cartão; não diga que a ação foi concluída.';
    }
    return payload;
  }

  private async *playbook(
    st: TurnState,
    eventKey: string,
    byId: Map<string, AgentSpec>,
  ): AsyncGenerator<StreamEventOut, [string, string][]> {
    const event = this.s.lifeEvents()[eventKey];
    const dates = nlu.parseDates(st.userText, this.s.today);
    const eventDate = toISO(dates.length ? dates[0] : this.s.today);
    const sections = new Map<string, string[]>();
    const order: string[] = [];
    for (const step of event.steps) {
      const agent = byId.get(step.agent);
      if (!agent || !agent.tools.includes(step.tool)) continue;
      if (!sections.has(agent.id)) {
        sections.set(agent.id, []);
        order.push(agent.id);
        yield ev('agent.start', { agent_id: agent.id, agent_name: agent.name });
        st.trace.agents.push(agent.id);
      }
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(step.args)) {
        args[k] = typeof v === 'string' ? v.replace('{event_date}', eventDate) : v;
      }
      const ctx = new ToolContext(st.identity, this.s, agent.id, st.conversationId, agent.knowledge);
      const ex = execute(ctx, step.tool, args, new Set(agent.tools));
      yield* this.emitExecution(st, ctx, agent, ex);
      sections.get(agent.id)!.push(ex.result.summary);
    }
    const card = {
      type: 'life_event',
      data: {
        event: eventKey,
        title: event.title,
        date: eventDate,
        steps: order.map((a) => ({ agent: byId.get(a)!.name, summaries: sections.get(a) })),
      },
    };
    st.cards.unshift(card);
    yield ev('card', { agent_id: 'concierge', card });
    return order.map((a) => [byId.get(a)!.name, (sections.get(a) ?? []).join(' ')] as [string, string]);
  }

  private compose(st: TurnState, sections: [string, string][], intro: string | null): string {
    const prompt = composePrompt(st.identity, this.s.branding);
    const body = sections.map(([name, text]) => `[${name}]\n${text}`).join('\n\n');
    const out = composeText(sections, intro);
    this.addUsage(st, countTokens(prompt) + countTokens(`Pergunta: ${st.userText}\n\n${body}`), countTokens(out));
    return out.trim() || body;
  }

  private async *sensitive(st: TurnState, check: InputCheck, visible: AgentSpec[]): AsyncGenerator<StreamEventOut> {
    const routed = makeDecision(
      'sensitive',
      ['compliance'],
      `Tema sensível (${check.sensitive}): encaminhamento humano com cuidado.`,
      { method: 'guardrail' },
    );
    const routeData = routeDict(routed);
    st.trace.route = routeData as unknown as Record<string, unknown>;
    yield ev('trace.route', { ...routeData, agent_names: ['Políticas e Compliance'] });
    const agent = visible.find((a) => a.id === 'compliance') ?? null;
    if (agent) {
      const ctx = new ToolContext(st.identity, this.s, 'compliance', st.conversationId, agent.knowledge);
      yield ev('agent.start', { agent_id: 'compliance', agent_name: agent.name });
      const ex = execute(ctx, 'compliance_support_channels', {}, new Set(agent.tools));
      yield* this.emitExecution(st, ctx, agent, ex);
    }
    const c = this.s.companyPolicies().compliance as Record<string, unknown>;
    const support = c.support_program as Record<string, string>;
    const ethics = c.ethics_channel as Record<string, string>;
    let text: string;
    if (check.highRisk) {
      text =
        'Sinto muito que você esteja passando por isso. Se você está em risco agora, ligue 188 (CVV, 24 horas, gratuito) ' +
        `ou 192 (SAMU). O ${support.name} também atende 24h pelo ${support.phone}, ` +
        'com sigilo. Você não precisa passar por isso sozinho(a).';
    } else if (check.sensitive === 'saúde mental') {
      text =
        'Obrigado por compartilhar. Cuidar da saúde mental é importante, e você não precisa resolver isso sozinho(a). ' +
        `O ${support.name} oferece apoio psicológico gratuito e confidencial, 24h, pelo ` +
        `${support.phone}. Não guardei os detalhes desta mensagem.`;
    } else {
      text =
        `Sinto muito pelo que aconteceu. Esse tipo de situação deve ser tratado pelo ${ethics.name}, ` +
        `que é sigiloso, aceita relatos anônimos e protege contra retaliação: ${ethics.url} ou ` +
        `${ethics.phone}. Eu não investigo nem registro os detalhes do relato aqui.`;
    }
    this.s.audit.append('chat.sensitive', {
      actor: st.identity.employeeId,
      conversation: st.conversationId,
      payload: { category: check.sensitive, high_risk: check.highRisk },
    });
    yield* this.finish(st, text, ['compliance'], undefined, true);
  }

  // ------------------------------------------------------------------ finish
  private async *finish(
    st: TurnState,
    text: string,
    agents: string[],
    suggestions?: string[],
    sensitive = false,
  ): AsyncGenerator<StreamEventOut> {
    const clean = text.replace(EMOJI, '').split('  ').join(' ').trim();
    const out = this.s.guardrails.checkOutput(clean, st.evidence, st.identity.name);
    for (const o of out.outcomes) {
      st.trace.guardrails.push(o);
      yield ev('trace.guardrail', { ...o });
    }
    if (out.blocked) {
      this.s.audit.append('guardrail.output_blocked', {
        actor: st.identity.employeeId,
        conversation: st.conversationId,
        payload: { outcomes: out.outcomes },
      });
    }
    const final = out.text;
    for (let i = 0; i < final.length; i += CHUNK) {
      yield ev('text.delta', { delta: final.slice(i, i + CHUNK) });
      if (this.streamDelayMs) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, this.streamDelayMs);
        await promise;
      }
    }
    const items = suggestions?.length ? suggestions : st.suggestions.slice(0, 3);
    if (items.length) yield ev('suggestions', { items });
    const usage = { ...st.usage, cost_usd: pyRound(st.usage.cost_usd, 6) };
    yield ev('usage', { ...usage });
    const payload = {
      trace: st.trace,
      cards: st.cards,
      citations: st.citations,
      proposals: st.proposals,
      usage,
      agents,
      suggestions: items,
    };
    const stored = sensitive ? '[resposta de encaminhamento sensível]' : final;
    const mid = this.s.conversations.add(st.identity.employeeId, st.conversationId, 'assistant', stored, payload);
    this.s.conversations.recordUsage(
      st.identity.employeeId,
      st.identity.unitId,
      st.conversationId,
      agents,
      usage,
      st.resolved,
    );
    this.s.audit.append('chat.turn', {
      actor: st.identity.employeeId,
      conversation: st.conversationId,
      request: st.identity.requestId,
      payload: {
        agents,
        tools: st.trace.tools.map((t) => `${t.tool}:${t.status}`),
        usage,
        message: mid,
      },
    });
    yield ev('message.end', { message_id: mid, resolved: st.resolved });
  }
}

export { fromISO };
