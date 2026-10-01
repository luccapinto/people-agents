/** Deterministic router (`atrium.runtime.router`).
 *
 *  Candidates are only the agents visible to the identity; an agent outside the list cannot be
 *  chosen. Order of decisions: life event playbook, general-purpose request, request id (FER-...),
 *  manager talking about the team, conversation follow-up, then the intent classifier
 *  (`intent.ts`) blended with each agent's lexical profile score (keywords, examples, name and
 *  description). Agents the classifier was not trained on (created in the Agent Studio) are chosen
 *  by their profile alone when it is clearly ahead. When no specialist is clearly ahead, the router
 *  asks ("Você quis dizer...") with the closest example question of each close candidate, never of
 *  an unrelated one. */
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import type { LexiconData, LifeEvent } from '../data/types';
import type { IntentModel } from './intent';
import { clauses, contentWords, firstPerson, hasPhrase, normalize, singular, tokens, words } from './nlu';

export const CONFIDENT = 2.5; // profile score of an agent the classifier does not know, to be chosen on it alone
// Frozen on routing.yaml (64), the owner phrases and the synthetic held-out split only, before any
// blind measurement: a heavier lexical share kept the tuning set at 59/64; margins did not change it.
export const BLEND = 1.5; // weight of the lexical profile score next to the classifier score
export const MARGIN = 1.0; // classifier margin for a direct decision
export const CLOSE = 0.6; // candidates within this of the top are offered when the margin is short
export const CLAUSE_MARGIN = 1.5; // per-clause margin over the main agent for a compound question to call a second specialist
export const CLAUSE_EVIDENCE = 2.0; // profile score of that clause for the second specialist: at least one of its keywords
export const CONJUNCTIONS = [' e ', ' tambem ', ' alem disso ', ', e ', ' mais '];
export const DECIDE_VERBS = /\b(aprov|recus|reprov|neg|rejeit|autoriz)\w*/;
const REQUEST_ID = /\bfer-\d+\b/;
// The next step every "not found" answer offers; the ticket carries the unanswered question.
export const TICKET_LABEL = 'Abrir um chamado para o RH';
export const TICKET_CHIP = /\babrir um chamado para o rh\b/;
export const CAPABILITIES_CHIP = 'O que você consegue fazer?'; // the Concierge answers it: the fallback when no specialist fits
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
    private readonly lexicon: LexiconData,
    private readonly model: IntentModel,
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

  /** The agent's example questions, closest to the text first. */
  private closestExamples(text: string, agentId: string): string[] {
    const words = new Set(contentWords(text));
    const examples = this.profiles.get(agentId)!.examples;
    const ratio = (e: string): number => {
      const other = new Set(contentWords(e));
      const union = new Set([...words, ...other]);
      return [...words].filter((w) => other.has(w)).length / (union.size || 1);
    };
    return examples
      .map((e, i) => [ratio(e), i, e] as [number, number, string])
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .map(([, , e]) => e);
  }

  private closestExample(text: string, agentId: string): string {
    const ranked = this.closestExamples(text, agentId);
    return ranked.length ? ranked[0] : `Sobre ${this.profiles.get(agentId)!.name}`;
  }

  /** Chips for an answer that found nothing: questions of the probable domain the assistant can
   *  answer (the agent's own, or for the Concierge the closest specialists'), then the HR ticket. */
  nextSteps(text: string, visible: string[], agentId: string): string[] {
    let options: string[];
    if (agentId !== 'concierge' && this.profiles.has(agentId)) {
      options = this.closestExamples(text, agentId);
    } else {
      const lexical: Record<string, number> = {};
      for (const a of visible) lexical[a] = this.score(text, a);
      const ranked = this.blended(text, visible, lexical).filter(([, a]) => a !== 'concierge');
      const top = ranked.length ? ranked[0][0] : 0;
      options = ranked
        .filter(([s]) => s > 0 && s >= top - CLOSE)
        .slice(0, 2)
        .map(([, a]) => this.closestExample(text, a));
      if (options.length < 2 && ranked.length) options.push(this.closestExample(text, ranked[0][1]));
    }
    if (visible.includes('concierge')) options.push(CAPABILITIES_CHIP);
    const f = fold(text);
    const kept = [...new Set(options.filter((o) => fold(o) !== f))];
    return [...kept.slice(0, 2), TICKET_LABEL];
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

    return this.classified(text, visible, scored, scores);
  }

  /** Visible agents the classifier knows, by classifier score plus a share of the profile score.
   *  Container words ("o documento do meu holerite") are generic, so the classifier does not read them. */
  blended(text: string, visible: string[], lexical: Record<string, number>): [number, string][] {
    const kept = words(fold(text)).filter((w) => !this.containers.has(singular(w)));
    const clf = this.model.scores(kept.join(' '));
    return visible
      .filter((a) => a in clf)
      .map((a) => [pyRound(clf[a] + BLEND * (lexical[a] ?? 0), 6), a] as [number, string])
      .sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  }

  private classified(
    text: string,
    visible: string[],
    scored: [number, string][],
    scores: Record<string, number>,
  ): RouteDecision {
    const lexical: Record<string, number> = {};
    for (const [s, a] of scored) lexical[a] = s;
    const ranked = this.blended(text, visible, lexical);
    // An agent the classifier never saw (Agent Studio) wins on its own profile when clearly ahead.
    const unknown = scored.filter(([, a]) => !this.model.classes.includes(a));
    const known = scored.filter(([, a]) => this.model.classes.includes(a));
    const knownBest = known.length ? Math.max(...known.map(([s]) => s)) : 0;
    if (unknown.length && unknown[0][0] >= CONFIDENT && unknown[0][0] > knownBest) {
      const a = unknown[0][1];
      return decision('single', [a], `Maior aderência ao perfil de ${this.profiles.get(a)!.name}.`, { scores });
    }
    if (!ranked.length) {
      // only agents the classifier does not know, none clearly ahead
      return decision('direct', ['concierge'], 'Nenhum especialista com sinal suficiente; o Concierge responde.', { scores });
    }
    const [s1, a1] = ranked[0];
    const s2 = ranked.length > 1 ? ranked[1][0] : s1 - 2 * MARGIN;
    // A compound question: another specialist only for a clause the main one clearly cannot answer.
    if (CONJUNCTIONS.some((c) => ` ${fold(text)} `.includes(c))) {
      const asked: string[] = a1 !== 'concierge' ? [a1] : [];
      for (const clause of clauses(text)) {
        if (contentWords(clause).length < 2) continue;
        const lexicalClause: Record<string, number> = {};
        for (const a of visible) lexicalClause[a] = this.score(clause, a);
        const rankedClause = this.blended(clause, visible, lexicalClause);
        const part: Record<string, number> = {};
        for (const [s, a] of rankedClause) part[a] = s;
        const top = rankedClause.length ? rankedClause[0][1] : 'concierge';
        // The clause must name the second topic itself ("e quantos dias de férias"), not lean on a prior.
        if (
          top !== 'concierge' &&
          !asked.includes(top) &&
          (lexicalClause[top] ?? 0) >= CLAUSE_EVIDENCE &&
          part[top] - (part[a1] ?? part[top]) >= CLAUSE_MARGIN
        ) {
          asked.push(top);
        }
      }
      if (asked.length >= 2) {
        const agents = asked.slice(0, 3);
        const names = agents.map((a) => this.profiles.get(a)!.name).join(' e ');
        return decision('multi', agents, `Pergunta composta: ${names}.`, { scores });
      }
    }
    if (a1 === 'concierge') {
      return decision('direct', ['concierge'], 'Pergunta geral: o Concierge responde.', { scores });
    }
    if (s1 - s2 >= MARGIN) {
      return decision('single', [a1], `Classificado como ${this.profiles.get(a1)!.name}.`, { scores });
    }
    const close = ranked
      .filter(([s, a]) => s >= s1 - CLOSE && a !== 'concierge')
      .slice(0, 3)
      .map(([, a]) => a);
    if (close.length >= 2) {
      return this.clarify(text, close, scores, 'Pergunta ambígua entre especialistas.');
    }
    return decision('single', [a1], `Classificado como ${this.profiles.get(a1)!.name}.`, { scores });
  }
}
