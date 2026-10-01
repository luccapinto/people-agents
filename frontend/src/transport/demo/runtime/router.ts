/** Deterministic lexical router (`atrium.runtime.router`). */
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import type { LifeEvent } from '../data/types';
import { containsPhrase, tokens } from './nlu';

export const DIRECT_THRESHOLD = 1.5;
export const MULTI_MIN = 2.0;
export const CONJUNCTIONS = [' e ', ' tambem ', ' alem disso ', ', e ', ' mais '];

export interface RoutingProfile {
  agentId: string;
  name: string;
  description: string;
  keywords: string[];
  examples: string[];
}

export interface RouteDecision {
  mode: string;
  agents: string[];
  reason: string;
  method: string;
  lifeEvent: string | null;
  scores: Record<string, number>;
  clarification: string | null;
}

export interface RouteDict {
  mode: string;
  agents: string[];
  reason: string;
  method: string;
  life_event: string | null;
  scores: Record<string, number>;
  clarification: string | null;
}

export function routeDict(d: RouteDecision): RouteDict {
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.scores)) scores[k] = pyRound(v, 2);
  return {
    mode: d.mode,
    agents: d.agents,
    reason: d.reason,
    method: d.method,
    life_event: d.lifeEvent,
    scores,
    clarification: d.clarification,
  };
}

export function decision(
  mode: string,
  agents: string[],
  reason: string,
  extra: Partial<Omit<RouteDecision, 'mode' | 'agents' | 'reason'>> = {},
): RouteDecision {
  return {
    mode,
    agents,
    reason,
    method: extra.method ?? 'lexical',
    lifeEvent: extra.lifeEvent ?? null,
    scores: extra.scores ?? {},
    clarification: extra.clarification ?? null,
  };
}

export class LexicalRouter {
  private readonly profiles = new Map<string, RoutingProfile>();
  private readonly bags = new Map<string, Set<string>>();
  private readonly idf = new Map<string, number>();

  constructor(
    profiles: RoutingProfile[],
    private readonly lifeEvents: Record<string, LifeEvent>,
  ) {
    for (const p of profiles) this.profiles.set(p.agentId, p);
    const df = new Map<string, number>();
    for (const p of profiles) {
      const bag = new Set(tokens([p.name, p.description, ...p.examples].join(' ')));
      this.bags.set(p.agentId, bag);
      for (const t of bag) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = Math.max(1, profiles.length);
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + n / c));
  }

  score(text: string, agentId: string): number {
    const p = this.profiles.get(agentId);
    if (!p) return 0;
    const f = fold(text);
    let s = 0;
    for (const kw of p.keywords) {
      if (containsPhrase(f, kw)) s += 2.0 + 0.5 * (kw.split(' ').length - 1);
    }
    const bag = this.bags.get(agentId) ?? new Set<string>();
    const overlap = [...new Set(tokens(text))].filter((t) => bag.has(t)).sort();
    for (const t of overlap) s += 0.6 * (this.idf.get(t) ?? 0);
    return pyRound(s, 4);
  }

  detectLifeEvent(text: string): string | null {
    const f = fold(text);
    for (const key of Object.keys(this.lifeEvents).sort()) {
      if (this.lifeEvents[key].keywords.some((kw) => containsPhrase(f, kw))) return key;
    }
    return null;
  }

  route(text: string, candidates: string[]): RouteDecision {
    const visible = candidates.filter((c) => this.profiles.has(c));
    const event = this.detectLifeEvent(text);
    if (event) {
      const steps = this.lifeEvents[event].steps.map((s) => s.agent);
      const agents = steps.filter((a, i) => visible.includes(a) && !steps.slice(0, i).includes(a));
      if (agents.length) {
        return decision('life_event', agents, `Evento de vida reconhecido: ${this.lifeEvents[event].title}.`, {
          lifeEvent: event,
        });
      }
    }
    const scored = visible
      .filter((a) => a !== 'concierge')
      .map((a) => [this.score(text, a), a] as [number, string])
      .sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    const scores: Record<string, number> = {};
    for (const [s, a] of scored) if (s > 0) scores[a] = s;
    if (!scored.length || scored[0][0] < DIRECT_THRESHOLD) {
      return decision('direct', ['concierge'], 'Nenhum especialista com sinal suficiente; o Concierge responde.', { scores });
    }
    const [s1, a1] = scored[0];
    const [s2, a2] = scored.length > 1 ? scored[1] : ([0, ''] as [number, string]);
    const f = ` ${fold(text)} `;
    if (s2 >= MULTI_MIN && s2 >= 0.6 * s1 && CONJUNCTIONS.some((c) => f.includes(c))) {
      const n1 = this.profiles.get(a1)!.name;
      const n2 = this.profiles.get(a2)!.name;
      return decision('multi', [a1, a2], `Pergunta composta: ${n1} e ${n2}.`, { scores });
    }
    if (s1 < 2.5 && s2 >= 0.9 * s1) {
      const n1 = this.profiles.get(a1)!.name;
      const n2 = this.profiles.get(a2)!.name;
      return decision('clarify', [a1, a2], 'Pergunta ambígua entre dois especialistas.', {
        scores,
        clarification: `Você quer falar sobre ${n1} ou sobre ${n2}?`,
      });
    }
    return decision('single', [a1], `Maior aderência ao perfil de ${this.profiles.get(a1)!.name}.`, { scores });
  }
}
