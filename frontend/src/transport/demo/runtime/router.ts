/** Deterministic lexical router (`atrium.runtime.router`).
 *
 *  Scores each candidate agent's routing profile (keywords, example utterances, name and
 *  description) with plural-insensitive phrase matches plus IDF-weighted token overlap, on the
 *  text expanded by the shared lexicon (shared/catalog/lexicon.yaml). Candidates are only the
 *  agents visible to the identity; an agent outside the list cannot be chosen.
 *
 *  Order of decisions: life event playbook, general-purpose request, request id (FER-...),
 *  conversation follow-up, then scores. When no specialist is clearly ahead, the router asks
 *  ("Você quis dizer...") with the closest example question of each candidate instead of guessing. */
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import type { LexiconData, LifeEvent } from '../data/types';
import { contentWords, firstPerson, hasPhrase, normalize, tokens } from './nlu';

export const DIRECT_THRESHOLD = 1.5;
export const CONFIDENT = 2.5;
export const MULTI_MIN = 2.0;
export const CLARIFY_MIN = 0.6;
export const CONJUNCTIONS = [' e ', ' tambem ', ' alem disso ', ', e ', ' mais '];
const DECIDE_VERBS = /\b(aprov|recus|reprov|neg|rejeit|autoriz)\w*/;
const REQUEST_ID = /\bfer-\d+\b/;
export const GENERAL_LABELS: Record<string, string> = {
  redacao: 'redação de texto',
  traducao: 'tradução',
  resumo: 'resumo',
  revisao: 'revisão de texto',
  codigo: 'programação',
  'conhecimento geral': 'conhecimento geral',
};
// Asking how to do something ("como escrevo a justificativa?") is a question for a specialist,
// not a request for the assistant to write.
const HOW_TO = /\bcomo\s+(?:eu\s+)?(?:escrev|redij|tradu|resum|revis|corrij|elabor|mont|cri)\w*/;

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
  suggestions: string[];
  general: string | null;
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
    suggestions: extra.suggestions ?? [],
    general: extra.general ?? null,
  };
}

const YEAR = /\b20\d{2}\b|\b(?:esse|este|neste|nesse|no)\s+ano\b/;
const CLOCK = /\b\d{1,2}h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b/;

/** Normalized text with lexicon variants replaced by their canonical term, followed by the
 *  original normalized text (so both the canonical and the literal words can match). A year
 *  adds the word "ano" and a clock time ("9h", "18:30") the word "horario". */
export function expand(text: string, synonyms: Record<string, string[]>): string {
  const original = normalize(text);
  let out = ` ${original} `;
  const pairs: [string, string][] = [];
  for (const [canonical, variants] of Object.entries(synonyms)) {
    for (const v of variants) pairs.push([normalize(v), normalize(canonical)]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [variant, canonical] of pairs) {
    if (variant && out.includes(` ${variant} `)) out = out.split(` ${variant} `).join(` ${canonical} `);
  }
  const folded = fold(text);
  const cues: string[] = [];
  if (YEAR.test(folded)) cues.push('ano');
  if (CLOCK.test(folded)) cues.push('horario');
  out = [out.trim(), ...cues].join(' ');
  return out === original ? out : `${out} ‖ ${original}`;
}

export class LexicalRouter {
  private readonly profiles = new Map<string, RoutingProfile>();
  private readonly bags = new Map<string, Set<string>>();
  private readonly idf = new Map<string, number>();
  private readonly synonyms: Record<string, string[]>;
  private readonly containers: Set<string>;

  constructor(
    profiles: RoutingProfile[],
    private readonly lifeEvents: Record<string, LifeEvent>,
    private readonly lexicon: LexiconData = {},
  ) {
    for (const p of profiles) this.profiles.set(p.agentId, p);
    this.synonyms = this.lexicon.synonyms ?? {};
    this.containers = new Set((this.lexicon.containers ?? []).map(normalize));
    const df = new Map<string, number>();
    for (const p of profiles) {
      const bag = new Set(tokens([p.name, p.description, ...p.examples].join(' ')));
      this.bags.set(p.agentId, bag);
      for (const t of bag) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = Math.max(1, profiles.length);
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + n / c));
  }

  expanded(text: string): string {
    return expand(text, this.synonyms);
  }

  score(text: string, agentId: string, expandedText?: string): number {
    const p = this.profiles.get(agentId);
    if (!p) return 0;
    const n = expandedText ?? this.expanded(text);
    let s = 0;
    for (const kw of p.keywords) {
      if (hasPhrase(n, kw)) s += this.containers.has(normalize(kw)) ? 0.75 : 2.0 + 0.5 * (kw.split(' ').length - 1);
    }
    const bag = this.bags.get(agentId) ?? new Set<string>();
    const overlap = [...new Set(tokens(n))].filter((t) => bag.has(t)).sort();
    for (const t of overlap) s += 0.6 * (this.idf.get(t) ?? 0);
    return pyRound(s, 4);
  }

  detectLifeEvent(text: string, expandedText?: string): string | null {
    const n = expandedText ?? this.expanded(text);
    for (const key of Object.keys(this.lifeEvents).sort()) {
      if (this.lifeEvents[key].keywords.some((kw) => hasPhrase(n, kw))) return key;
    }
    return null;
  }

  generalKind(text: string, expandedText?: string): string | null {
    const n = expandedText ?? this.expanded(text);
    for (const [kind, phrases] of Object.entries(this.lexicon.general ?? {})) {
      if (phrases.some((ph) => hasPhrase(n, ph))) {
        if (['redacao', 'traducao', 'resumo', 'revisao'].includes(kind) && HOW_TO.test(fold(text))) continue;
        return kind;
      }
    }
    return null;
  }

  private closestExample(text: string, agentId: string): string {
    const profile = this.profiles.get(agentId)!;
    const examples = profile.examples;
    if (!examples.length) return `Sobre ${profile.name}`;
    const words = new Set(contentWords(text));
    let best = examples[0];
    let bestScore = -1;
    for (const e of examples) {
      const other = new Set(contentWords(e));
      const union = new Set([...words, ...other]);
      const shared = [...words].filter((w) => other.has(w)).length;
      const score = shared / (union.size || 1);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private clarify(text: string, agents: string[], scores: Record<string, number>, reason: string): RouteDecision {
    return decision('clarify', agents, reason, {
      scores,
      clarification: 'Você quis dizer...',
      suggestions: agents.map((a) => this.closestExample(text, a)),
    });
  }

  route(text: string, candidates: string[], previous: string[] = []): RouteDecision {
    const visible = candidates.filter((c) => this.profiles.has(c));
    const n = this.expanded(text);
    const event = this.detectLifeEvent(text, n);
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
      .map((a) => [this.score(text, a, n), a] as [number, string])
      .sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    const best = scored.length ? scored[0][0] : 0;

    const general = this.generalKind(text, n);
    if (
      general &&
      visible.includes('concierge') &&
      (!['codigo', 'conhecimento geral'].includes(general) || best < CONFIDENT)
    ) {
      return decision('general', ['concierge'], `Pedido de uso geral (${GENERAL_LABELS[general]}): o Concierge responde.`, {
        general,
      });
    }

    const f = fold(text);
    const rid = REQUEST_ID.exec(f);
    if (rid) {
      if (DECIDE_VERBS.test(f) && visible.includes('leadership')) {
        return decision('single', ['leadership'], `Decisão sobre o pedido ${rid[0].toUpperCase()}.`);
      }
      if (visible.includes('vacation')) {
        return decision('single', ['vacation'], `Pedido de férias ${rid[0].toUpperCase()}.`);
      }
    }

    const scores: Record<string, number> = {};
    for (const [s, a] of scored) if (s > 0) scores[a] = s;
    if (visible.includes('leadership')) {
      // A manager talking about the team ("eles", "minha equipe") or about deciding something
      // ("esperando eu aprovar") is asking Liderança, whatever else the sentence mentions.
      const team = (this.lexicon.team_reference ?? []).filter((x) => hasPhrase(n, x)).map(normalize);
      let rest = ` ${normalize(text)} `;
      for (const phrase of team) rest = rest.split(` ${phrase} `).join(' ');
      const byMe = (this.lexicon.approval_by_me ?? []).some((x) => hasPhrase(n, x));
      if (byMe || (team.length && !firstPerson(rest))) {
        return decision('single', ['leadership'], 'Pergunta sobre o time da pessoa gestora.', { scores });
      }
    }

    // A short follow-up without a subject of its own ("e de hora extra?") stays with the specialist
    // of the previous turn in the same conversation.
    const prev = previous.length === 1 ? previous[0] : null;
    if (
      prev &&
      visible.includes(prev) &&
      prev !== 'concierge' &&
      (scores[prev] ?? 0) > 0 &&
      !firstPerson(text) &&
      contentWords(text).length <= 8
    ) {
      return decision('single', [prev], `Continuação da conversa com ${this.profiles.get(prev)!.name}.`, { scores });
    }

    if (!scored.length || scored[0][0] < DIRECT_THRESHOLD) {
      const weak = scored.filter(([s]) => s >= CLARIFY_MIN).slice(0, 3).map(([, a]) => a);
      if (weak.length >= 2) {
        return this.clarify(text, weak, scores, 'Sinal fraco para vários especialistas: perguntar antes de encaminhar.');
      }
      return decision('direct', ['concierge'], 'Nenhum especialista com sinal suficiente; o Concierge responde.', { scores });
    }
    const [s1, a1] = scored[0];
    const [s2, a2] = scored.length > 1 ? scored[1] : ([0, ''] as [number, string]);
    const padded = ` ${f} `;
    if (s2 >= MULTI_MIN && s2 >= 0.6 * s1 && CONJUNCTIONS.some((c) => padded.includes(c))) {
      const n1 = this.profiles.get(a1)!.name;
      const n2 = this.profiles.get(a2)!.name;
      return decision('multi', [a1, a2], `Pergunta composta: ${n1} e ${n2}.`, { scores });
    }
    if (s1 < CONFIDENT && s2 >= 0.9 * s1) {
      const close = scored.filter(([s]) => s >= 0.75 * s1).slice(0, 3).map(([, a]) => a);
      return this.clarify(text, close, scores, 'Pergunta ambígua entre especialistas.');
    }
    return decision('single', [a1], `Maior aderência ao perfil de ${this.profiles.get(a1)!.name}.`, { scores });
  }
}
