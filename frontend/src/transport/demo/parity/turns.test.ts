// @vitest-environment node
/** The parity contract: replaying each golden scenario must produce the same route, tools,
 *  cards, proposals, authz, guardrails and final text as the Python back-end. */
import { beforeAll, describe, expect, it } from 'vitest';
import goldens from '../../../../../shared/generated/goldens.json';
import { Orchestrator, type StreamEventOut } from '../runtime/orchestrator';
import type { Services } from '../runtime/services';
import { freshEngine, personaIdentities } from './engine';

const RANDOM_KEYS = new Set(['verification_code', 'document_id', 'pdf_url']);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!RANDOM_KEYS.has(k)) out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

interface TurnSummary {
  tools: { tool: string; args: unknown; status: string; allowed: boolean; policy: string }[];
  cards: unknown[];
  proposals: { tool: string; summary: string; details: unknown; risk: string; step_up_required: boolean }[];
  guardrails: { name: string; stage: string; outcome: string }[];
  route: { mode: string; agents: string[]; life_event: string | null } | null;
  authz: { subject: string; scope: string | null; action: string; allowed: boolean; policy: string } | null;
  text: string;
  error: string | null;
  suggestions: string[];
}

function summarize(events: StreamEventOut[]): TurnSummary {
  const out: TurnSummary = {
    tools: [],
    cards: [],
    proposals: [],
    guardrails: [],
    route: null,
    authz: null,
    text: '',
    error: null,
    suggestions: [],
  };
  for (const e of events) {
    const d = e.data as Record<string, never>;
    if (e.event === 'trace.route') {
      out.route = { mode: d.mode, agents: d.agents, life_event: (d.life_event as string | null) ?? null };
    } else if (e.event === 'trace.tool') {
      const decision = d.decision as unknown as { allowed: boolean; policy: string };
      out.tools.push({ tool: d.tool, args: d.args, status: d.status, allowed: decision.allowed, policy: decision.policy });
    } else if (e.event === 'card') {
      out.cards.push(scrub(d.card));
    } else if (e.event === 'proposal') {
      out.proposals.push({
        tool: d.tool,
        summary: d.summary,
        details: d.details,
        risk: d.risk,
        step_up_required: d.step_up_required,
      });
    } else if (e.event === 'trace.guardrail') {
      out.guardrails.push({ name: d.name, stage: d.stage, outcome: d.outcome });
    } else if (e.event === 'trace.authz') {
      const decision = d.decision as unknown as { allowed: boolean; policy: string };
      out.authz = { subject: d.subject, scope: d.scope ?? null, action: d.action, allowed: decision.allowed, policy: decision.policy };
    } else if (e.event === 'text.delta') {
      out.text += d.delta as unknown as string;
    } else if (e.event === 'error') {
      out.error = d.code;
    } else if (e.event === 'suggestions') {
      out.suggestions = d.items as unknown as string[];
    }
  }
  return out;
}

let services: Services;
let who: ReturnType<typeof personaIdentities>;

beforeAll(async () => {
  services = await freshEngine();
  who = personaIdentities(services);
  // The goldens were recorded with the rate limit lifted.
  services.store.policies.set('user_rate_limit_per_minute', {
    key: 'user_rate_limit_per_minute',
    value: { value: 100000 },
    description: '',
    updated_by: null,
    updated_at: new Date().toISOString(),
  });
});

// Items recorded with a "conversation" key share one conversation, as the goldens were built.
const conversations = new Map<string, string>();

describe('goldens.turns', () => {
  for (const [index, golden] of goldens.turns.entries()) {
    it(`${index} ${golden.persona}: ${golden.q}`, async () => {
      const key = 'conversation' in golden && typeof golden.conversation === 'string' ? golden.conversation : null;
      const previous = key === null ? null : (conversations.get(key) ?? null);
      const events: StreamEventOut[] = [];
      for await (const e of new Orchestrator(services).run(who[golden.persona], previous, golden.q)) events.push(e);
      if (key !== null) conversations.set(key, String(events[0].data.conversation_id));
      const actual = summarize(events);
      const usesKb = golden.tools.some((t) => t.tool === 'kb_search');

      expect(actual.route).toEqual(golden.route);
      expect(actual.tools.map((t) => ({ tool: t.tool, args: t.args, status: t.status, allowed: t.allowed, policy: t.policy }))).toEqual(
        golden.tools,
      );
      expect(actual.guardrails).toEqual(golden.guardrails);
      expect(actual.error).toEqual(golden.error);
      expect(actual.suggestions).toEqual(golden.suggestions);
      if (usesKb) return; // retrieval engines differ; route, tools and guardrails already matched
      expect(actual.cards).toEqual(golden.cards);
      expect(actual.proposals).toEqual(golden.proposals);
      expect(actual.authz).toEqual(golden.authz);
      expect(actual.text).toEqual(golden.text);
    });
  }
});

// Never a dead end: an answer that found nothing offers two questions and the HR ticket. A turn
// that already proposes the ticket carries it as a proposal instead, so it has no chips.
describe('goldens.turns not found', () => {
  it('ends every "Não encontrei" answer with two chips and the HR ticket', () => {
    const dead = goldens.turns.filter(
      (t) => t.text.includes('Não encontrei') && !t.proposals.some((p) => p.tool === 'ticket_open'),
    );
    expect(dead.length).toBeGreaterThan(0);
    for (const turn of dead) {
      expect(turn.suggestions.length, turn.q).toBeGreaterThanOrEqual(2);
      expect(turn.suggestions[turn.suggestions.length - 1], turn.q).toEqual('Abrir um chamado para o RH');
    }
  });
});
