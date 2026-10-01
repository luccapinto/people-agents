"""Whose data a message asks for, decided before routing (ported to the demo as subject.ts).

A message that asks about someone else must never be answered with the speaker's own data. This
module finds the subject of a personal-data request: a named colleague, the speaker's manager,
the speaker's team, a group (a role, an area, "os colegas", an average) or everyone. The
orchestrator then asks the policy engine, and ``execute()`` refuses self-service tools for the
whole turn when the subject is not the speaker.

Matching is on folded word sequences (``shared/catalog/lexicon.yaml``, section ``subjects``). A
domain word ("salário", "férias") counts for someone else when it is attached to them: "o salário
do meu gestor", "a folha de pagamento do time", "salário médio dos analistas", "every salary",
"quanto ganham os engenheiros", "what do the other people on my floor earn?". "Meu gestor vê meu
salário?" and "pedi férias à minha gestora" stay about the speaker.

Two outcomes are neither the speaker nor a refusal. ``rules``: the sentence asks what people are
entitled to ("como funciona o banco de horas da equipe?", "os estagiários têm 13º?"); nothing is
refused, but self-service tools stay closed and the knowledge base answers. ``ambiguous``: a
domain word belongs to nobody in particular while someone else acts in the sentence ("minha
gestora tem quantos dias de férias?"); the assistant asks whose data it is, with two chips.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from atrium.runtime.nlu import WORD
from atrium.text import fold

ACTIONS = {"compensation": "team.compensation.read", "vacation": "team.vacation.read", "time": "team.time.read",
           "personal": "other.personal.read"}
LABELS = {"compensation": "o salário ou o holerite", "vacation": "as férias", "time": "o banco de horas",
          "personal": "os dados pessoais"}
QUESTION_FORMS = ("quanto ganha", "quanto ganham", "quanto recebe", "quanto recebem")
LINK_FREE = ("deles", "delas")  # "as férias deles" carries its own "de"
PRIORITY = ("person", "manager", "team", "group", "company")
MAX_LINK_GAP = 3  # tokens between a domain word and the people it belongs to
MAX_QUESTION_GAP = 4  # "quanto ganha um desenvolvedor sênior", "how much does a senior developer make"
MAX_VERB_GAP = 3  # "meu chefe ganha bem", "the other people on my floor earn"
CLAUSE_END = re.compile(r"[?!.;]+")
TYPED_WORD = re.compile(r"[^\W_]+")
CONTRACTED = {"o": "do", "a": "da", "os": "dos", "as": "das"}
POSSESSIVE_GENITIVE = {"meu": "do", "minha": "da", "meus": "dos", "minhas": "das", "nosso": "do", "nossa": "da",
                       "nossos": "dos", "nossas": "das"}
PLAIN_DE = {"todo", "toda", "todos", "todas", "cada", "um", "uma", "my", "the", "our", "every", "all", "each", "everyone",
            "everybody"}


@dataclass(frozen=True)
class Subject:
    kind: str  # person | manager | team | group | company | rules | ambiguous
    domain: str  # compensation | vacation | time | personal
    person_id: str | None = None
    # person: a first name several colleagues share ("a Camila"), when unresolved;
    # ambiguous: the chip that asks for the other person's data ("Férias da minha gestora").
    name: str | None = None

    @property
    def action(self) -> str:
        return ACTIONS[self.domain]

    @property
    def label(self) -> str:
        return LABELS[self.domain]


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    tag: str


def words(text: str) -> list[str]:
    return WORD.findall(fold(text))


def clauses(text: str) -> list[int]:
    """The sentence each token of ``words(text)`` belongs to (split at ? ! . ;)."""
    out: list[int] = []
    for k, segment in enumerate(CLAUSE_END.split(fold(text))):
        out += [k] * len(WORD.findall(segment))
    return out


def find(toks: list[str], phrases: list[str], tag: str) -> list[Span]:
    out = []
    for phrase in phrases:
        p = words(phrase)
        out += [Span(i, i + len(p), tag) for i in range(len(toks) - len(p) + 1) if p and toks[i:i + len(p)] == p]
    return out


def typed(text: str, phrase: list[str]) -> str:
    """The words of ``phrase`` (folded tokens) as the person typed them, lowercased: accents kept."""
    spans = [(m.group(), WORD.findall(fold(m.group()))) for m in TYPED_WORD.finditer(text)]
    flat = [(i, t) for i, (_w, ts) in enumerate(spans) for t in ts]
    n = len(phrase)
    for k in range(len(flat) - n + 1):
        if n and [t for _i, t in flat[k:k + n]] == phrase:
            return " ".join(w for w, _ts in spans[flat[k][0]:flat[k + n - 1][0] + 1]).lower()
    return " ".join(phrase)


def genitive(ref: str, feminine: set[str]) -> str:
    """'minha gestora' -> 'da minha gestora', 'o time' -> 'do time', 'equipe' -> 'da equipe'."""
    first, *rest = ref.split()
    f = fold(first)
    if f in CONTRACTED:
        return " ".join([CONTRACTED[f], *rest])
    if f in POSSESSIVE_GENITIVE:
        return f"{POSSESSIVE_GENITIVE[f]} {ref}"
    if f in PLAIN_DE:
        return f"de {ref}"
    return f"{'da' if f in feminine else 'do'}{'s' if f.endswith('s') else ''} {ref}"


class SubjectResolver:
    def __init__(self, lexicon: dict) -> None:
        v = lexicon.get("subjects", {})
        self.domains: dict[str, list[str]] = v.get("domains", {})
        self.person_only: list[str] = v.get("person_only", [])
        self.possessive = set(v.get("self_possessive", []))
        self.links = set(v.get("links", []))
        self.group_links = set(v.get("group_links", []))
        self.articles = set(v.get("articles", []))
        self.fillers = set(v.get("fillers", []))
        self.money_verbs = set(v.get("money_verbs", []))
        self.pay_questions: list[str] = v.get("pay_questions", [])
        self.question_pay_verbs = set(v.get("question_pay_verbs", []))
        self.refs: dict[str, list[str]] = {k: v.get(k, []) for k in ("manager", "team", "group", "company")}
        self.roles: list[str] = v.get("role", [])
        self.aggregate: list[str] = v.get("aggregate", [])
        self.time_words = set(v.get("time_words", []))
        self.rule_cues: list[str] = v.get("rule_cues", [])
        self.entitlement_verbs = set(v.get("entitlement_verbs", []))
        self.third_person = set(v.get("third_person", []))
        self.first_person = set(v.get("first_person", []))
        self.feminine = set(v.get("feminine", []))

    def resolve(self, text: str, speaker_id: str, manager_id: str | None, is_manager: bool,
                directory: dict[str, str], team_first_names: dict[str, str]) -> Subject | None:
        """The subject when it is someone other than the speaker, ``rules`` or ``ambiguous``; ``None``
        otherwise (the speaker's own data, or no personal data at all)."""
        toks = words(text)
        clause = clauses(text)
        domains = [s for d, phrases in self.domains.items() for s in find(toks, phrases, d)]
        open_domains = [d for d in domains if not self._self_attached(toks, d)]
        open_person = [d for d in find(toks, self.person_only, "personal") if not self._self_attached(toks, d)]
        questions = [q for q in find(toks, self.pay_questions, "question")]
        verbs = self._pay_verbs(toks, clause, domains, questions)
        found: dict[str, tuple[str, int]] = {}  # kind -> (domain, token where it was found)

        person, shared_name = self._person(text, toks, speaker_id, directory, team_first_names)
        if (person or shared_name) and (open_domains or open_person or verbs):
            first = (open_domains + open_person)[0] if open_domains or open_person else None
            found["person"] = (first.tag, first.start) if first else ("compensation", verbs[0])

        refs_by_kind: dict[str, list[Span]] = {}
        for kind, phrases in self.refs.items():
            refs = [r for r in find(toks, phrases, kind) if not self._time_quantifier(toks, r)]
            if kind == "team":  # "time off" is a domain word, not the Portuguese "time" (team)
                refs = [r for r in refs if not any(d.start < r.end and r.start < d.end for d in domains)]
            if kind == "group":
                refs += self._roles_after_question(toks, clause, domains, questions, verbs)
            refs_by_kind[kind] = refs
            hit = self._attached(toks, open_domains + (open_person if kind == "manager" else []), refs, kind)
            if hit is None:
                v = next((v for r in refs for v in verbs if self._verb_of(toks, clause, r, v)), None)
                hit = ("compensation", v) if v is not None else None
            if hit:
                found[kind] = hit
        for a in find(toks, self.aggregate, "compensation"):
            if not self._self_attached(toks, a):
                found.setdefault("group", ("compensation", a.start))

        rules = None
        for kind in PRIORITY:
            if kind not in found or (kind == "manager" and not manager_id):
                continue
            kind_out = "group" if kind == "team" and not is_manager else kind  # a colleague's "meu time" is their peers
            domain, at = found[kind]
            if kind_out in ("group", "company") and self._rule_clause(toks, clause, clause[at], questions):
                rules = rules or Subject("rules", domain)  # "como funciona o banco de horas da equipe?"
                continue
            if kind == "person":
                return Subject(kind_out, domain, person, None if person else shared_name)
            return Subject(kind_out, domain, manager_id if kind == "manager" else None)
        return rules or self._unclear(text, toks, clause, open_domains, refs_by_kind, manager_id, questions)

    def _unclear(self, text: str, toks: list[str], clause: list[int], open_domains: list[Span],
                 refs_by_kind: dict[str, list[Span]], manager_id: str | None, questions: list[Span]) -> Subject | None:
        """A domain word attached to nobody, with someone else in the same sentence: a rules question,
        a question about that someone ("minha gestora tem quantos dias de férias?") or the speaker's."""
        for d in open_domains:
            c = clause[d.start]
            in_clause = [t for i, t in enumerate(toks) if clause[i] == c]
            if any(t in self.first_person for t in in_clause):
                continue  # "minha gestora pediu que eu tirasse férias": the speaker acts
            refs = [r for kind, rs in refs_by_kind.items() for r in rs
                    if clause[r.start] == c and (kind != "manager" or manager_id) and not (r.start < d.end and d.start < r.end)]
            if not refs:
                continue
            if self._rule_clause(toks, clause, c, questions):
                return Subject("rules", d.tag)
            if any(t in self.third_person for t in in_clause):
                r = min(refs, key=lambda r: abs(r.start - d.start))
                chip = f"{typed(text, toks[d.start:d.end])} {genitive(typed(text, toks[r.start:r.end]), self.feminine)}"
                return Subject("ambiguous", d.tag, None, chip[:1].upper() + chip[1:])
        return None

    def _rule_clause(self, toks: list[str], clause: list[int], c: int, questions: list[Span]) -> bool:
        """The sentence asks about the rules: a cue ("como funciona", "tem direito", "política"), or
        an entitlement verb right before a domain word ("os estagiários têm 13º?") with no pay question."""
        if any(clause[s.start] == c for cue in self.rule_cues for s in find(toks, [cue], "cue")):
            return True
        if any(clause[q.start] == c for q in questions):
            return False
        starts = {s.start for phrases in self.domains.values() for s in find(toks, phrases, "d")}
        for i, t in enumerate(toks):
            if clause[i] == c and t in self.entitlement_verbs:
                j = i + 1
                while j < len(toks) and toks[j] in self.articles:
                    j += 1
                if j in starts:
                    return True
        return False

    def _pay_verbs(self, toks: list[str], clause: list[int], domains: list[Span], questions: list[Span]) -> list[int]:
        """Third-person pay verbs ("ganha", "earn"), or "recebe"/"make" after a pay question; not
        when the object is another domain ("a equipe ganha folga?" asks about a day off)."""
        out = []
        for i, t in enumerate(toks):
            asked = any(q.end <= i and clause[q.start] == clause[i] for q in questions)
            if t in self.money_verbs or (t in self.question_pay_verbs and asked):
                j = i + 1
                while j < len(toks) and toks[j] in self.articles:
                    j += 1
                if any(d.start == j and d.tag != "compensation" for d in domains):
                    continue
                out.append(i)
        return out

    def _verb_of(self, toks: list[str], clause: list[int], r: Span, v: int) -> bool:
        """The pay verb belongs to these people: they come first, in the same sentence, close by, and
        the speaker does not act in between ("what do the other people on my floor earn?")."""
        between = toks[r.end:v]
        return (0 <= v - r.end <= MAX_VERB_GAP and clause[v] == clause[r.start]
                and not any(t in self.first_person for t in between))

    def _self_attached(self, toks: list[str], d: Span) -> bool:
        """'meu salário', 'minhas férias', 'meu próprio holerite'."""
        before = toks[d.start - 1] if d.start >= 1 else ""
        return before in self.possessive or (before in ("proprio", "propria") and d.start >= 2 and toks[d.start - 2] in self.possessive)

    def _time_quantifier(self, toks: list[str], r: Span) -> bool:
        """'de todos os meses', 'every month': a quantifier over time, not over people."""
        i = r.end
        while i < len(toks) and toks[i] in self.articles:
            i += 1
        return i < len(toks) and toks[i] in self.time_words

    def _attached(self, toks: list[str], domains: list[Span], refs: list[Span], kind: str) -> tuple[str, int] | None:
        """(domain, position) of the first domain word attached to one of these people, if any."""
        links = self.links | (self.group_links if kind in ("group", "company") else set())
        between_ok = links | self.articles | self.fillers
        for d in domains:
            question = " ".join(toks[d.start:d.end]) in QUESTION_FORMS
            for r in refs:
                if r.start < d.end and d.start < r.end:  # one phrase: "every salary", "todos os salarios"
                    return d.tag, d.start
                if r.start >= d.end:  # domain word, then the people
                    between = toks[d.end:r.start]
                    if question and len(between) <= MAX_QUESTION_GAP:
                        return d.tag, d.start
                    linked = any(t in links for t in between) or (not between and " ".join(toks[r.start:r.end]) in LINK_FREE)
                    if linked and len(between) <= MAX_LINK_GAP and all(t in between_ok for t in between):
                        return d.tag, d.start
                else:  # the people, then the domain word: "my manager's salary", "team payroll"
                    between = toks[r.end:d.start]
                    if between == ["s"] or (not between and kind == "team" and toks[r.end - 1] == "team"):
                        return d.tag, d.start
        return None

    def _roles_after_question(self, toks: list[str], clause: list[int], domains: list[Span], questions: list[Span],
                              verbs: list[int]) -> list[Span]:
        """'quanto ganha um desenvolvedor sênior', 'how much does a senior developer make': a role
        after a pay question is a group."""
        asked = [d for d in domains if " ".join(toks[d.start:d.end]) in QUESTION_FORMS]
        asked += [q for q in questions if any(v > q.end and clause[v] == clause[q.start] for v in verbs)]
        return [r for r in find(toks, self.roles, "group") for q in asked if 0 <= r.start - q.end <= MAX_QUESTION_GAP]

    def _person(self, text: str, toks: list[str], speaker_id: str, directory: dict[str, str],
                team_first_names: dict[str, str]) -> tuple[str | None, str | None]:
        """A colleague named in full, by the first name of someone in a manager's team (in any case:
        "aprova as férias da camila"), or by a capitalized first name: unique gives the person,
        shared by several gives the name alone ("a Camila", unresolved)."""
        padded = f" {' '.join(toks)} "
        full = next((eid for eid, name in directory.items() if eid != speaker_id and f" {' '.join(words(name))} " in padded), None)
        if full:
            return full, None
        firsts: dict[str, list[str]] = {}
        for eid, name in directory.items():
            if eid != speaker_id:
                firsts.setdefault(fold(name.split()[0]), []).append(eid)
        shared = None
        for token in sorted(set(toks)):
            if team_first_names.get(token, speaker_id) != speaker_id:
                return team_first_names[token], None
            ids = firsts.get(token, [])
            if ids and token.capitalize() in text:
                if len(ids) == 1:
                    return ids[0], None
                shared = shared or token.capitalize()
        return None, shared
