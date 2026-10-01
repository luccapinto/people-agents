/** Whose data a message asks for, decided before routing (port of `atrium.runtime.subject`).
 *
 *  A message that asks about someone else must never be answered with the speaker's own data.
 *  This module finds the subject of a personal-data request: a named colleague, the speaker's
 *  manager, the speaker's team, a group (a role, an area, "os colegas", an average) or everyone.
 *  The orchestrator then asks the policy engine, and `execute()` refuses self-service tools for
 *  the whole turn when the subject is not the speaker.
 *
 *  Matching is on folded word sequences (`shared/catalog/lexicon.yaml`, section `subjects`). A
 *  domain word ("salário", "férias") counts for someone else when it is attached to them: "o
 *  salário do meu gestor", "a folha de pagamento do time", "salário médio dos analistas", "every
 *  salary", "quanto ganham os engenheiros", "what do the other people on my floor earn?". "Meu
 *  gestor vê meu salário?" and "pedi férias à minha gestora" stay about the speaker.
 *
 *  Two outcomes are neither the speaker nor a refusal. `rules`: the sentence asks what people are
 *  entitled to ("como funciona o banco de horas da equipe?", "os estagiários têm 13º?"); nothing
 *  is refused, but self-service tools stay closed and the knowledge base answers. `ambiguous`: a
 *  domain word belongs to nobody in particular while someone else acts in the sentence ("minha
 *  gestora tem quantos dias de férias?"); the assistant asks whose data it is, with two chips. */
import { capitalize, fold } from '../core/text';
import type { LexiconData, LexiconSubjects } from '../data/types';
import { WORD } from './nlu';

export const ACTIONS: Record<string, string> = {
  compensation: 'team.compensation.read',
  vacation: 'team.vacation.read',
  time: 'team.time.read',
  personal: 'other.personal.read',
};
export const LABELS: Record<string, string> = {
  compensation: 'o salário ou o holerite',
  vacation: 'as férias',
  time: 'o banco de horas',
  personal: 'os dados pessoais',
};
const QUESTION_FORMS = ['quanto ganha', 'quanto ganham', 'quanto recebe', 'quanto recebem'];
const LINK_FREE = ['deles', 'delas']; // "as férias deles" carries its own "de"
const PRIORITY = ['person', 'manager', 'team', 'group', 'company'];
const REF_KINDS = ['manager', 'team', 'group', 'company'] as const;
const MAX_LINK_GAP = 3; // tokens between a domain word and the people it belongs to
const MAX_QUESTION_GAP = 4; // "quanto ganha um desenvolvedor sênior", "how much does a senior developer make"
const MAX_VERB_GAP = 3; // "meu chefe ganha bem", "the other people on my floor earn"
const CLAUSE_END = /[?!.;]+/;
const TYPED_WORD = /[\p{L}\p{N}]+/gu;
const CONTRACTED: Record<string, string> = { o: 'do', a: 'da', os: 'dos', as: 'das' };
const POSSESSIVE_GENITIVE: Record<string, string> = {
  meu: 'do',
  minha: 'da',
  meus: 'dos',
  minhas: 'das',
  nosso: 'do',
  nossa: 'da',
  nossos: 'dos',
  nossas: 'das',
};
const PLAIN_DE = ['todo', 'toda', 'todos', 'todas', 'cada', 'um', 'uma', 'my', 'the', 'our', 'every', 'all', 'each', 'everyone', 'everybody'];

const NO_SUBJECTS: LexiconSubjects = {
  domains: {},
  person_only: [],
  self_possessive: [],
  money_verbs: [],
  pay_questions: [],
  question_pay_verbs: [],
  links: [],
  group_links: [],
  articles: [],
  fillers: [],
  manager: [],
  team: [],
  group: [],
  role: [],
  aggregate: [],
  company: [],
  time_words: [],
  rule_cues: [],
  entitlement_verbs: [],
  third_person: [],
  first_person: [],
  feminine: [],
};

export interface Subject {
  /** person | manager | team | group | company | rules | ambiguous */
  kind: string;
  /** compensation | vacation | time | personal */
  domain: string;
  personId: string | null;
  /** person: a first name several colleagues share ("a Camila"), when unresolved;
   *  ambiguous: the chip that asks for the other person's data ("Férias da minha gestora"). */
  name: string | null;
}

interface Span {
  start: number;
  end: number;
  tag: string;
}

export function words(text: string): string[] {
  return fold(text).match(WORD) ?? [];
}

/** The sentence each token of `words(text)` belongs to (split at ? ! . ;). */
export function clauses(text: string): number[] {
  const out: number[] = [];
  const segments = fold(text).split(CLAUSE_END);
  for (const [k, segment] of segments.entries()) {
    const n = (segment.match(WORD) ?? []).length;
    for (let i = 0; i < n; i += 1) out.push(k);
  }
  return out;
}

function find(toks: string[], phrases: string[], tag: string): Span[] {
  const out: Span[] = [];
  for (const phrase of phrases) {
    const p = words(phrase);
    if (!p.length) continue;
    for (let i = 0; i + p.length <= toks.length; i += 1) {
      if (p.every((w, k) => toks[i + k] === w)) out.push({ start: i, end: i + p.length, tag });
    }
  }
  return out;
}

/** The words of `phrase` (folded tokens) as the person typed them, lowercased: accents kept. */
export function typed(text: string, phrase: string[]): string {
  const spans: [string, string[]][] = [];
  for (const m of text.matchAll(TYPED_WORD)) spans.push([m[0], words(m[0])]);
  const flat: [number, string][] = [];
  for (const [i, [, ts]] of spans.entries()) for (const t of ts) flat.push([i, t]);
  const n = phrase.length;
  for (let k = 0; k + n <= flat.length; k += 1) {
    if (n && phrase.every((t, j) => flat[k + j][1] === t)) {
      return spans
        .slice(flat[k][0], flat[k + n - 1][0] + 1)
        .map(([w]) => w)
        .join(' ')
        .toLowerCase();
    }
  }
  return phrase.join(' ');
}

/** "minha gestora" -> "da minha gestora", "o time" -> "do time", "equipe" -> "da equipe". */
export function genitive(ref: string, feminine: Set<string>): string {
  const parts = ref.split(/\s+/);
  const f = fold(parts[0]);
  if (f in CONTRACTED) return [CONTRACTED[f], ...parts.slice(1)].join(' ');
  if (f in POSSESSIVE_GENITIVE) return `${POSSESSIVE_GENITIVE[f]} ${ref}`;
  if (PLAIN_DE.includes(f)) return `de ${ref}`;
  return `${feminine.has(f) ? 'da' : 'do'}${f.endsWith('s') ? 's' : ''} ${ref}`;
}

export class SubjectResolver {
  private readonly domains: Record<string, string[]>;
  private readonly personOnly: string[];
  private readonly possessive: Set<string>;
  private readonly links: Set<string>;
  private readonly groupLinks: Set<string>;
  private readonly articles: Set<string>;
  private readonly fillers: Set<string>;
  private readonly moneyVerbs: Set<string>;
  private readonly payQuestions: string[];
  private readonly questionPayVerbs: Set<string>;
  private readonly refs: Record<string, string[]>;
  private readonly roles: string[];
  private readonly aggregate: string[];
  private readonly timeWords: Set<string>;
  private readonly ruleCues: string[];
  private readonly entitlementVerbs: Set<string>;
  private readonly thirdPerson: Set<string>;
  private readonly firstPerson: Set<string>;
  private readonly feminine: Set<string>;

  constructor(lexicon: LexiconData) {
    const v = lexicon.subjects ?? NO_SUBJECTS;
    this.domains = v.domains;
    this.personOnly = v.person_only;
    this.possessive = new Set(v.self_possessive);
    this.links = new Set(v.links);
    this.groupLinks = new Set(v.group_links);
    this.articles = new Set(v.articles);
    this.fillers = new Set(v.fillers);
    this.moneyVerbs = new Set(v.money_verbs);
    this.payQuestions = v.pay_questions;
    this.questionPayVerbs = new Set(v.question_pay_verbs);
    this.refs = { manager: v.manager, team: v.team, group: v.group, company: v.company };
    this.roles = v.role;
    this.aggregate = v.aggregate;
    this.timeWords = new Set(v.time_words);
    this.ruleCues = v.rule_cues;
    this.entitlementVerbs = new Set(v.entitlement_verbs);
    this.thirdPerson = new Set(v.third_person);
    this.firstPerson = new Set(v.first_person);
    this.feminine = new Set(v.feminine);
  }

  /** The subject when it is someone other than the speaker, `rules` or `ambiguous`; `null`
   *  otherwise (the speaker's own data, or no personal data at all). */
  resolve(
    text: string,
    speakerId: string,
    managerId: string | null,
    isManager: boolean,
    directory: Map<string, string>,
    teamFirstNames: Map<string, string>,
  ): Subject | null {
    const toks = words(text);
    const clause = clauses(text);
    const domains: Span[] = [];
    for (const [d, phrases] of Object.entries(this.domains)) domains.push(...find(toks, phrases, d));
    const openDomains = domains.filter((d) => !this.selfAttached(toks, d));
    const openPerson = find(toks, this.personOnly, 'personal').filter((d) => !this.selfAttached(toks, d));
    const questions = find(toks, this.payQuestions, 'question');
    const verbs = this.payVerbs(toks, clause, domains, questions);
    const found: Record<string, [string, number]> = {}; // kind -> (domain, token where it was found)

    const [person, sharedName] = this.person(text, toks, speakerId, directory, teamFirstNames);
    const attachable = [...openDomains, ...openPerson];
    if ((person || sharedName) && (attachable.length || verbs.length)) {
      found.person = attachable.length ? [attachable[0].tag, attachable[0].start] : ['compensation', verbs[0]];
    }

    const refsByKind: Record<string, Span[]> = {};
    for (const kind of REF_KINDS) {
      let refs = find(toks, this.refs[kind], kind).filter((r) => !this.timeQuantifier(toks, r));
      // "time off" is a domain word, not the Portuguese "time" (team).
      if (kind === 'team') refs = refs.filter((r) => !domains.some((d) => d.start < r.end && r.start < d.end));
      if (kind === 'group') refs = [...refs, ...this.rolesAfterQuestion(toks, clause, domains, questions, verbs)];
      refsByKind[kind] = refs;
      let hit = this.attached(toks, kind === 'manager' ? attachable : openDomains, refs, kind);
      if (hit === null) {
        let v: number | null = null;
        for (const r of refs) {
          for (const candidate of verbs) {
            if (this.verbOf(toks, clause, r, candidate)) {
              v = candidate;
              break;
            }
          }
          if (v !== null) break;
        }
        hit = v !== null ? ['compensation', v] : null;
      }
      if (hit) found[kind] = hit;
    }
    for (const a of find(toks, this.aggregate, 'compensation')) {
      if (!this.selfAttached(toks, a) && !( 'group' in found)) found.group = ['compensation', a.start];
    }

    let rules: Subject | null = null;
    for (const kind of PRIORITY) {
      const entry = found[kind];
      if (entry === undefined || (kind === 'manager' && !managerId)) continue;
      // A colleague's "meu time" is their peers, not a team they lead.
      const kindOut = kind === 'team' && !isManager ? 'group' : kind;
      const [domain, at] = entry;
      if ((kindOut === 'group' || kindOut === 'company') && this.ruleClause(toks, clause, clause[at], questions)) {
        // "como funciona o banco de horas da equipe?"
        rules = rules ?? { kind: 'rules', domain, personId: null, name: null };
        continue;
      }
      if (kind === 'person') return { kind: kindOut, domain, personId: person, name: person ? null : sharedName };
      return { kind: kindOut, domain, personId: kind === 'manager' ? managerId : null, name: null };
    }
    return rules ?? this.unclear(text, toks, clause, openDomains, refsByKind, managerId, questions);
  }

  /** A domain word attached to nobody, with someone else in the same sentence: a rules question, a
   *  question about that someone ("minha gestora tem quantos dias de férias?") or the speaker's. */
  private unclear(
    text: string,
    toks: string[],
    clause: number[],
    openDomains: Span[],
    refsByKind: Record<string, Span[]>,
    managerId: string | null,
    questions: Span[],
  ): Subject | null {
    for (const d of openDomains) {
      const c = clause[d.start];
      const inClause = toks.filter((_t, i) => clause[i] === c);
      // "minha gestora pediu que eu tirasse férias": the speaker acts.
      if (inClause.some((t) => this.firstPerson.has(t))) continue;
      const refs: Span[] = [];
      for (const kind of REF_KINDS) {
        for (const r of refsByKind[kind]) {
          if (clause[r.start] === c && (kind !== 'manager' || managerId) && !(r.start < d.end && d.start < r.end)) refs.push(r);
        }
      }
      if (!refs.length) continue;
      if (this.ruleClause(toks, clause, c, questions)) return { kind: 'rules', domain: d.tag, personId: null, name: null };
      if (inClause.some((t) => this.thirdPerson.has(t))) {
        let near = refs[0];
        for (const r of refs.slice(1)) if (Math.abs(r.start - d.start) < Math.abs(near.start - d.start)) near = r;
        const chip = `${typed(text, toks.slice(d.start, d.end))} ${genitive(typed(text, toks.slice(near.start, near.end)), this.feminine)}`;
        return { kind: 'ambiguous', domain: d.tag, personId: null, name: chip.slice(0, 1).toUpperCase() + chip.slice(1) };
      }
    }
    return null;
  }

  /** The sentence asks about the rules: a cue ("como funciona", "tem direito", "política"), or an
   *  entitlement verb right before a domain word ("os estagiários têm 13º?") with no pay question. */
  private ruleClause(toks: string[], clause: number[], c: number, questions: Span[]): boolean {
    for (const cue of this.ruleCues) if (find(toks, [cue], 'cue').some((s) => clause[s.start] === c)) return true;
    if (questions.some((q) => clause[q.start] === c)) return false;
    const starts = new Set<number>();
    for (const phrases of Object.values(this.domains)) for (const s of find(toks, phrases, 'd')) starts.add(s.start);
    for (const [i, t] of toks.entries()) {
      if (clause[i] !== c || !this.entitlementVerbs.has(t)) continue;
      let j = i + 1;
      while (j < toks.length && this.articles.has(toks[j])) j += 1;
      if (starts.has(j)) return true;
    }
    return false;
  }

  /** Third-person pay verbs ("ganha", "earn"), or "recebe"/"make" after a pay question; not when
   *  the object is another domain ("a equipe ganha folga?" asks about a day off). */
  private payVerbs(toks: string[], clause: number[], domains: Span[], questions: Span[]): number[] {
    const out: number[] = [];
    for (const [i, t] of toks.entries()) {
      const asked = questions.some((q) => q.end <= i && clause[q.start] === clause[i]);
      if (!this.moneyVerbs.has(t) && !(this.questionPayVerbs.has(t) && asked)) continue;
      let j = i + 1;
      while (j < toks.length && this.articles.has(toks[j])) j += 1;
      if (domains.some((d) => d.start === j && d.tag !== 'compensation')) continue;
      out.push(i);
    }
    return out;
  }

  /** The pay verb belongs to these people: they come first, in the same sentence, close by, and the
   *  speaker does not act in between ("what do the other people on my floor earn?"). */
  private verbOf(toks: string[], clause: number[], r: Span, v: number): boolean {
    const between = toks.slice(r.end, v);
    return (
      v - r.end >= 0 &&
      v - r.end <= MAX_VERB_GAP &&
      clause[v] === clause[r.start] &&
      !between.some((t) => this.firstPerson.has(t))
    );
  }

  /** "meu salário", "minhas férias", "meu próprio holerite". */
  private selfAttached(toks: string[], d: Span): boolean {
    const before = d.start >= 1 ? toks[d.start - 1] : '';
    return (
      this.possessive.has(before) ||
      ((before === 'proprio' || before === 'propria') && d.start >= 2 && this.possessive.has(toks[d.start - 2]))
    );
  }

  /** "de todos os meses", "every month": a quantifier over time, not over people. */
  private timeQuantifier(toks: string[], r: Span): boolean {
    let i = r.end;
    while (i < toks.length && this.articles.has(toks[i])) i += 1;
    return i < toks.length && this.timeWords.has(toks[i]);
  }

  /** (domain, position) of the first domain word attached to one of these people, if any. */
  private attached(toks: string[], domains: Span[], refs: Span[], kind: string): [string, number] | null {
    const links = kind === 'group' || kind === 'company' ? new Set([...this.links, ...this.groupLinks]) : this.links;
    const betweenOk = new Set([...links, ...this.articles, ...this.fillers]);
    for (const d of domains) {
      const question = QUESTION_FORMS.includes(toks.slice(d.start, d.end).join(' '));
      for (const r of refs) {
        // One phrase: "every salary", "todos os salarios".
        if (r.start < d.end && d.start < r.end) return [d.tag, d.start];
        if (r.start >= d.end) {
          // domain word, then the people
          const between = toks.slice(d.end, r.start);
          if (question && between.length <= MAX_QUESTION_GAP) return [d.tag, d.start];
          const linked =
            between.some((t) => links.has(t)) ||
            (!between.length && LINK_FREE.includes(toks.slice(r.start, r.end).join(' ')));
          if (linked && between.length <= MAX_LINK_GAP && between.every((t) => betweenOk.has(t))) return [d.tag, d.start];
        } else {
          // the people, then the domain word: "my manager's salary", "team payroll"
          const between = toks.slice(r.end, d.start);
          if ((between.length === 1 && between[0] === 's') || (!between.length && kind === 'team' && toks[r.end - 1] === 'team')) {
            return [d.tag, d.start];
          }
        }
      }
    }
    return null;
  }

  /** "quanto ganha um desenvolvedor sênior", "how much does a senior developer make": a role after
   *  a pay question is a group. */
  private rolesAfterQuestion(toks: string[], clause: number[], domains: Span[], questions: Span[], verbs: number[]): Span[] {
    const asked = domains.filter((d) => QUESTION_FORMS.includes(toks.slice(d.start, d.end).join(' ')));
    asked.push(...questions.filter((q) => verbs.some((v) => v > q.end && clause[v] === clause[q.start])));
    const out: Span[] = [];
    for (const r of find(toks, this.roles, 'group')) {
      for (const q of asked) if (r.start - q.end >= 0 && r.start - q.end <= MAX_QUESTION_GAP) out.push(r);
    }
    return out;
  }

  /** A colleague named in full, by the first name of someone in a manager's team (in any case:
   *  "aprova as férias da camila"), or by a capitalized first name: unique gives the person,
   *  shared by several gives the name alone ("a Camila", unresolved). */
  private person(
    text: string,
    toks: string[],
    speakerId: string,
    directory: Map<string, string>,
    teamFirstNames: Map<string, string>,
  ): [string | null, string | null] {
    const padded = ` ${toks.join(' ')} `;
    for (const [eid, name] of directory) {
      if (eid !== speakerId && padded.includes(` ${words(name).join(' ')} `)) return [eid, null];
    }
    const firsts = new Map<string, string[]>();
    for (const [eid, name] of directory) {
      if (eid === speakerId) continue;
      const key = fold(name.split(/\s+/)[0]);
      firsts.set(key, [...(firsts.get(key) ?? []), eid]);
    }
    let shared: string | null = null;
    for (const token of [...new Set(toks)].sort()) {
      const teamId = teamFirstNames.get(token);
      if (teamId !== undefined && teamId !== speakerId) return [teamId, null];
      const ids = firsts.get(token) ?? [];
      if (ids.length && text.includes(capitalize(token))) {
        if (ids.length === 1) return [ids[0], null];
        shared = shared ?? capitalize(token);
      }
    }
    return [null, shared];
  }
}
