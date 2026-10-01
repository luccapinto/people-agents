/** Whose data a message asks for, decided before routing (port of `atrium.runtime.subject`).
 *
 *  A message that asks about someone else must never be answered with the speaker's own data.
 *  This module finds the subject of a personal-data request: a named colleague, the speaker's
 *  manager, the speaker's team, a group (a role, an area, "os colegas", an average) or everyone.
 *  The orchestrator then asks the policy engine, and `execute()` refuses self-service tools for
 *  the whole turn when the subject is not the speaker.
 *
 *  Matching is on folded word sequences (`shared/catalog/lexicon.yaml`, section `subjects`). A
 *  domain word ("salário", "férias") counts for someone else only when it is attached to them:
 *  "o salário do meu gestor", "a folha de pagamento do time", "salário médio dos analistas",
 *  "every salary", "quanto ganham os engenheiros". "Meu gestor vê meu salário?" and "pedi férias
 *  à minha gestora" stay about the speaker. */
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
const QUESTION_FORMS = ['quanto ganha', 'quanto ganham', 'quanto recebe', 'quanto recebem', 'how much does', 'how much do'];
const LINK_FREE = ['deles', 'delas']; // "as férias deles" carries its own "de"
const PRIORITY = ['person', 'manager', 'team', 'group', 'company'];
const REF_KINDS = ['manager', 'team', 'group', 'company'] as const;
const MAX_LINK_GAP = 3; // tokens between a domain word and the people it belongs to
const MAX_QUESTION_GAP = 4; // "quanto ganha um desenvolvedor sênior", "how much does my manager make"
const MAX_VERB_GAP = 2; // "meu chefe ganha bem", "o pessoal do meu time ganha"

const NO_SUBJECTS: LexiconSubjects = {
  domains: {},
  person_only: [],
  self_possessive: [],
  money_verbs: [],
  quanto_verbs: [],
  links: [],
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
};

export interface Subject {
  /** person | manager | team | group | company */
  kind: string;
  /** compensation | vacation | time | personal */
  domain: string;
  personId: string | null;
  /** A first name shared by several colleagues ("a Camila"), when unresolved. */
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

export class SubjectResolver {
  private readonly domains: Record<string, string[]>;
  private readonly personOnly: string[];
  private readonly possessive: Set<string>;
  private readonly links: Set<string>;
  private readonly articles: Set<string>;
  private readonly between: Set<string>;
  private readonly moneyVerbs: Set<string>;
  private readonly quantoVerbs: Set<string>;
  private readonly refs: Record<string, string[]>;
  private readonly roles: string[];
  private readonly aggregate: string[];
  private readonly timeWords: Set<string>;
  private readonly ruleCues: string[];

  constructor(lexicon: LexiconData) {
    const v = lexicon.subjects ?? NO_SUBJECTS;
    this.domains = v.domains;
    this.personOnly = v.person_only;
    this.possessive = new Set(v.self_possessive);
    this.links = new Set(v.links);
    this.articles = new Set(v.articles);
    this.between = new Set([...v.links, ...v.articles, ...v.fillers]);
    this.moneyVerbs = new Set(v.money_verbs);
    this.quantoVerbs = new Set(v.quanto_verbs);
    this.refs = { manager: v.manager, team: v.team, group: v.group, company: v.company };
    this.roles = v.role;
    this.aggregate = v.aggregate;
    this.timeWords = new Set(v.time_words);
    this.ruleCues = v.rule_cues;
  }

  /** The subject when it is someone other than the speaker; `null` otherwise (the speaker's own
   *  data, or no personal data at all). */
  resolve(
    text: string,
    speakerId: string,
    managerId: string | null,
    isManager: boolean,
    directory: Map<string, string>,
    teamFirstNames: Map<string, string>,
  ): Subject | null {
    const toks = words(text);
    const domains: Span[] = [];
    for (const [d, phrases] of Object.entries(this.domains)) domains.push(...find(toks, phrases, d));
    const openDomains = domains.filter((d) => !this.selfAttached(toks, d));
    const openPerson = find(toks, this.personOnly, 'personal').filter((d) => !this.selfAttached(toks, d));
    const verbs: number[] = [];
    for (const [i, t] of toks.entries()) {
      if (this.moneyVerbs.has(t) || (this.quantoVerbs.has(t) && toks.slice(0, i).includes('quanto'))) verbs.push(i);
    }
    const found = new Map<string, string>();

    const [person, sharedName] = this.person(text, toks, speakerId, directory, teamFirstNames);
    const attachable = [...openDomains, ...openPerson];
    if ((person || sharedName) && (attachable.length || verbs.length)) {
      found.set('person', attachable.length ? attachable[0].tag : 'compensation');
    }

    for (const kind of REF_KINDS) {
      let refs = find(toks, this.refs[kind], kind).filter((r) => !this.timeQuantifier(toks, r));
      // "time off" is a domain word, not the Portuguese "time" (team).
      if (kind === 'team') refs = refs.filter((r) => !domains.some((d) => d.start < r.end && r.start < d.end));
      if (kind === 'group') refs = [...refs, ...this.rolesAfterQuestion(toks, domains)];
      let domain = this.attached(toks, kind === 'manager' ? attachable : openDomains, refs, kind);
      if (domain === null && refs.some((r) => verbs.some((v) => v - r.end >= 0 && v - r.end <= MAX_VERB_GAP))) {
        domain = 'compensation';
      }
      if (domain) found.set(kind, domain);
    }
    if (find(toks, this.aggregate, 'compensation').some((a) => !this.selfAttached(toks, a)) && !found.has('group')) {
      found.set('group', 'compensation');
    }

    for (const kind of PRIORITY) {
      const domain = found.get(kind);
      if (domain === undefined || (kind === 'manager' && !managerId)) continue;
      // A colleague's "meu time" is their peers, not a team they lead.
      const kindOut = kind === 'team' && !isManager ? 'group' : kind;
      if ((kindOut === 'group' || kindOut === 'company') && this.ruleCues.some((cue) => find(toks, [cue], 'cue').length)) {
        return null; // a question about the rules ("como funciona o banco de horas da empresa?")
      }
      if (kind === 'person') {
        return { kind: kindOut, domain, personId: person, name: person ? null : sharedName };
      }
      return { kind: kindOut, domain, personId: kind === 'manager' ? managerId : null, name: null };
    }
    return null;
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

  /** The domain of the first domain word attached to one of these people, if any. */
  private attached(toks: string[], domains: Span[], refs: Span[], kind: string): string | null {
    for (const d of domains) {
      const question = QUESTION_FORMS.includes(toks.slice(d.start, d.end).join(' '));
      for (const r of refs) {
        if (r.start < d.end && d.start < r.end) return d.tag; // one phrase: "every salary", "todos os salarios"
        if (r.start >= d.end) {
          // domain word, then the people
          const between = toks.slice(d.end, r.start);
          if (question && between.length <= MAX_QUESTION_GAP) return d.tag;
          const linked =
            between.some((t) => this.links.has(t)) ||
            (!between.length && LINK_FREE.includes(toks.slice(r.start, r.end).join(' ')));
          if (linked && between.length <= MAX_LINK_GAP && between.every((t) => this.between.has(t))) return d.tag;
        } else {
          // the people, then the domain word: "my manager's salary", "team payroll"
          const between = toks.slice(r.end, d.start);
          if ((between.length === 1 && between[0] === 's') || (!between.length && kind === 'team' && toks[r.end - 1] === 'team')) {
            return d.tag;
          }
        }
      }
    }
    return null;
  }

  /** "quanto ganha um desenvolvedor sênior": a role after a pay question is a group. */
  private rolesAfterQuestion(toks: string[], domains: Span[]): Span[] {
    const questions = domains.filter((d) => QUESTION_FORMS.includes(toks.slice(d.start, d.end).join(' ')));
    const out: Span[] = [];
    for (const r of find(toks, this.roles, 'group')) {
      for (const q of questions) if (r.start - q.end >= 0 && r.start - q.end <= MAX_QUESTION_GAP) out.push(r);
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
