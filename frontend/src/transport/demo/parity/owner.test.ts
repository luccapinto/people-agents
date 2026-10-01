// @vitest-environment node
/** The project owner's own phrases (shared/eval/owner-phrases.yaml) must work word for word,
 *  here and in the back-end (backend/tests/runtime/test_owner_phrases.py replays the same file).
 *  The out-of-domain, injection and benign sets guard the two ends of the knowledge gate and of
 *  the input guardrail: nothing cited when the corpus does not cover the question, every
 *  injection attempt blocked before any tool, no ordinary message blocked. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { IdentityContext } from '../authz/identity';
import { Orchestrator, type StreamEventOut } from '../runtime/orchestrator';
import type { Services } from '../runtime/services';
import { type YamlValue, loadYaml } from './eval-yaml';
import { freshEngine, personaIdentities } from './engine';

const EVAL = new URL('../../../../../shared/eval/', import.meta.url).pathname;

interface Item {
  persona: string;
  q: string;
  conversation?: string;
  agents?: string[];
  mode?: string;
  life_event?: string;
  tools?: string[];
  cards?: string[];
  proposals?: string[];
  step_up?: boolean;
  citations?: boolean | string[];
  no_citations?: boolean;
  suggestions?: number;
  guardrail?: { name: string; outcome: string };
  text?: string[];
}

function items(value: YamlValue): Item[] {
  return value as unknown as Item[];
}

const phrases = loadYaml(`${EVAL}owner-phrases.yaml`);
const OWNER = [...items(phrases.owner), ...items(phrases.visitor)];
const OUT_OF_DOMAIN = items(loadYaml(`${EVAL}out-of-domain.yaml`).questions);
const INJECTION = items(loadYaml(`${EVAL}injection.yaml`).attempts);
const BENIGN = items(loadYaml(`${EVAL}injection-benign.yaml`).messages);

interface Turn {
  conversationId: string;
  route: { mode: string; agents: string[]; life_event: string | null } | null;
  tools: { tool: string; status: string }[];
  cards: { type: string }[];
  proposals: { tool: string; step_up_required: boolean }[];
  citations: { kb: string; document: string }[];
  guardrails: { name: string; outcome: string }[];
  suggestions: number;
  text: string;
}

async function run(services: Services, identity: IdentityContext, q: string, conversationId: string | null): Promise<Turn> {
  const events: StreamEventOut[] = [];
  for await (const e of new Orchestrator(services).run(identity, conversationId, q)) events.push(e);
  const turn: Turn = {
    conversationId: '',
    route: null,
    tools: [],
    cards: [],
    proposals: [],
    citations: [],
    guardrails: [],
    suggestions: 0,
    text: '',
  };
  for (const e of events) {
    const d = e.data as Record<string, never>;
    if (e.event === 'message.start') turn.conversationId = String(d.conversation_id);
    else if (e.event === 'trace.route') {
      turn.route = { mode: d.mode, agents: d.agents, life_event: (d.life_event as string | null) ?? null };
    } else if (e.event === 'trace.tool') turn.tools.push({ tool: d.tool, status: d.status });
    else if (e.event === 'card') turn.cards.push(d.card as { type: string });
    else if (e.event === 'proposal') turn.proposals.push({ tool: d.tool, step_up_required: d.step_up_required });
    else if (e.event === 'citation') turn.citations.push({ kb: d.kb, document: d.document });
    else if (e.event === 'trace.guardrail') turn.guardrails.push({ name: d.name, outcome: d.outcome });
    else if (e.event === 'suggestions') turn.suggestions += 1;
    else if (e.event === 'text.delta') turn.text += d.delta as unknown as string;
  }
  return turn;
}

/** The same expectations as `problems()` in backend/tests/runtime/test_owner_phrases.py. */
function problems(turn: Turn, item: Item): string[] {
  const out: string[] = [];
  const route = turn.route;
  if (item.agents && String(route?.agents) !== String(item.agents)) {
    out.push(`agents ${route?.agents} != ${item.agents} (mode ${route?.mode})`);
  }
  if (item.mode && route?.mode !== item.mode) out.push(`mode ${route?.mode} != ${item.mode}`);
  if (item.life_event && route?.life_event !== item.life_event) {
    out.push(`life_event ${route?.life_event} != ${item.life_event}`);
  }
  for (const want of item.tools ?? []) {
    const [name, status] = want.split(':');
    if (!turn.tools.some((t) => t.tool === name && (!status || t.status === status))) {
      out.push(`tool ${want} missing (ran ${turn.tools.map((t) => `${t.tool}:${t.status}`).sort()})`);
    }
  }
  const shown = turn.cards.map((c) => c.type);
  for (const card of item.cards ?? []) if (!shown.includes(card)) out.push(`card ${card} missing (shown ${shown})`);
  const proposed = turn.proposals.map((p) => p.tool);
  for (const tool of item.proposals ?? []) {
    if (!proposed.includes(tool)) out.push(`proposal ${tool} missing (proposed ${proposed})`);
  }
  if (item.step_up && !(turn.proposals.length && turn.proposals[0].step_up_required)) {
    out.push('first proposal does not require step-up');
  }
  const cites = item.citations;
  if (cites === true && !turn.citations.length) out.push('no citation');
  else if (Array.isArray(cites) && !turn.citations.some((c) => cites.includes(c.kb))) {
    out.push(`citations ${turn.citations.map((c) => c.kb)} not from ${cites}`);
  }
  if (item.no_citations && turn.citations.length) out.push(`cited ${turn.citations.map((c) => c.document)}`);
  if (turn.suggestions < (item.suggestions ? 1 : 0)) out.push('no suggestions');
  const g = item.guardrail;
  if (g && !turn.guardrails.some((x) => x.name === g.name && x.outcome === g.outcome)) {
    out.push(`guardrail ${JSON.stringify(g)} missing (${JSON.stringify(turn.guardrails.map((x) => [x.name, x.outcome]))})`);
  }
  for (const snippet of item.text ?? []) {
    if (!turn.text.toLowerCase().includes(snippet.toLowerCase())) {
      out.push(`text lacks ${JSON.stringify(snippet)}: ${JSON.stringify(turn.text.slice(0, 160))}`);
    }
  }
  return out;
}

/** Consecutive items with the same "conversation" key run in order in one conversation. */
function groups(list: Item[]): [string, Item[]][] {
  const out: [string, Item[]][] = [];
  for (const item of list) {
    const key = item.conversation;
    if (key && out.length && out[out.length - 1][0] === key) out[out.length - 1][1].push(item);
    else out.push([key || item.q, [item]]);
  }
  return out;
}

let services: Services;
let who: Record<string, IdentityContext>;

beforeAll(async () => {
  services = await freshEngine();
  who = personaIdentities(services);
  services.store.policies.set('user_rate_limit_per_minute', {
    key: 'user_rate_limit_per_minute',
    value: { value: 100000 },
    description: '',
    updated_by: null,
    updated_at: new Date().toISOString(),
  });
});

describe('owner phrases', () => {
  for (const [key, group] of groups(OWNER)) {
    it(key.slice(0, 60), async () => {
      let conversation: string | null = null;
      const failures: string[] = [];
      for (const item of group) {
        const turn = await run(services, who[item.persona], item.q, conversation);
        conversation = item.conversation ? turn.conversationId : null;
        failures.push(...problems(turn, item).map((p) => `${JSON.stringify(item.q)}: ${p}`));
      }
      expect(failures.join('\n')).toEqual('');
    });
  }
});

describe('out of domain', () => {
  for (const item of OUT_OF_DOMAIN) {
    it(item.q, async () => {
      const turn = await run(services, who[item.persona], item.q, null);
      expect(turn.citations).toEqual([]);
      expect(turn.text).not.toContain('Segundo');
    });
  }
});

describe('injection attempts', () => {
  for (const item of INJECTION) {
    it(item.q, async () => {
      const turn = await run(services, who[item.persona], item.q, null);
      expect(turn.guardrails.filter((g) => g.name === 'prompt_injection' && g.outcome === 'block')).toHaveLength(1);
      expect(turn.tools).toEqual([]);
      expect(turn.route).toBeNull();
    });
  }
});

describe('benign messages', () => {
  for (const item of BENIGN) {
    it(item.q, async () => {
      const turn = await run(services, who[item.persona], item.q, null);
      expect(turn.guardrails.filter((g) => g.outcome === 'block')).toEqual([]);
    });
  }
});
