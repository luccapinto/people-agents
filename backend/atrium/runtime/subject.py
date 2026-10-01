"""Whose data a message asks for, decided before routing (ported to the demo as subject.ts).

A message that asks about someone else must never be answered with the speaker's own data. This
module finds the subject of a personal-data request: a named colleague, the speaker's manager,
the speaker's team, a group (a role, an area, "os colegas", an average) or everyone. The
orchestrator then asks the policy engine, and ``execute()`` refuses self-service tools for the
whole turn when the subject is not the speaker.

Matching is on folded word sequences (``shared/catalog/lexicon.yaml``, section ``subjects``). A
domain word ("salário", "férias") counts for someone else only when it is attached to them:
"o salário do meu gestor", "a folha de pagamento do time", "salário médio dos analistas",
"every salary", "quanto ganham os engenheiros". "Meu gestor vê meu salário?" and "pedi férias à
minha gestora" stay about the speaker.
"""

from __future__ import annotations

from dataclasses import dataclass

from atrium.runtime.nlu import WORD
from atrium.text import fold

ACTIONS = {"compensation": "team.compensation.read", "vacation": "team.vacation.read", "time": "team.time.read",
           "personal": "other.personal.read"}
LABELS = {"compensation": "o salário ou o holerite", "vacation": "as férias", "time": "o banco de horas",
          "personal": "os dados pessoais"}
QUESTION_FORMS = ("quanto ganha", "quanto ganham", "quanto recebe", "quanto recebem", "how much does", "how much do")
LINK_FREE = ("deles", "delas")  # "as férias deles" carries its own "de"
PRIORITY = ("person", "manager", "team", "group", "company")
MAX_LINK_GAP = 3  # tokens between a domain word and the people it belongs to
MAX_QUESTION_GAP = 4  # "quanto ganha um desenvolvedor sênior", "how much does my manager make"
MAX_VERB_GAP = 2  # "meu chefe ganha bem", "o pessoal do meu time ganha"


@dataclass(frozen=True)
class Subject:
    kind: str  # person | manager | team | group | company
    domain: str  # compensation | vacation | time | personal
    person_id: str | None = None
    name: str | None = None  # a first name shared by several colleagues ("a Camila"), when unresolved

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


def find(toks: list[str], phrases: list[str], tag: str) -> list[Span]:
    out = []
    for phrase in phrases:
        p = words(phrase)
        out += [Span(i, i + len(p), tag) for i in range(len(toks) - len(p) + 1) if p and toks[i:i + len(p)] == p]
    return out


class SubjectResolver:
    def __init__(self, lexicon: dict) -> None:
        v = lexicon.get("subjects", {})
        self.domains: dict[str, list[str]] = v.get("domains", {})
        self.person_only: list[str] = v.get("person_only", [])
        self.possessive = set(v.get("self_possessive", []))
        self.links = set(v.get("links", []))
        self.articles = set(v.get("articles", []))
        self.between = self.links | self.articles | set(v.get("fillers", []))
        self.money_verbs = set(v.get("money_verbs", []))
        self.quanto_verbs = set(v.get("quanto_verbs", []))
        self.refs: dict[str, list[str]] = {k: v.get(k, []) for k in ("manager", "team", "group", "company")}
        self.roles: list[str] = v.get("role", [])
        self.aggregate: list[str] = v.get("aggregate", [])
        self.time_words = set(v.get("time_words", []))
        self.rule_cues: list[str] = v.get("rule_cues", [])

    def resolve(self, text: str, speaker_id: str, manager_id: str | None, is_manager: bool,
                directory: dict[str, str], team_first_names: dict[str, str]) -> Subject | None:
        """The subject when it is someone other than the speaker; ``None`` otherwise (the speaker's
        own data, or no personal data at all)."""
        toks = words(text)
        domains = [s for d, phrases in self.domains.items() for s in find(toks, phrases, d)]
        open_domains = [d for d in domains if not self._self_attached(toks, d)]
        open_person = [d for d in find(toks, self.person_only, "personal") if not self._self_attached(toks, d)]
        verbs = [i for i, t in enumerate(toks) if t in self.money_verbs or (t in self.quanto_verbs and "quanto" in toks[:i])]
        found: dict[str, str] = {}

        person, shared_name = self._person(text, toks, speaker_id, directory, team_first_names)
        if (person or shared_name) and (open_domains or open_person or verbs):
            found["person"] = (open_domains + open_person)[0].tag if open_domains or open_person else "compensation"

        for kind, phrases in self.refs.items():
            refs = [r for r in find(toks, phrases, kind) if not self._time_quantifier(toks, r)]
            if kind == "team":  # "time off" is a domain word, not the Portuguese "time" (team)
                refs = [r for r in refs if not any(d.start < r.end and r.start < d.end for d in domains)]
            if kind == "group":
                refs += self._roles_after_question(toks, domains)
            domain = self._attached(toks, open_domains + (open_person if kind == "manager" else []), refs, kind)
            if domain is None and any(0 <= v - r.end <= MAX_VERB_GAP for r in refs for v in verbs):
                domain = "compensation"
            if domain:
                found[kind] = domain
        if any(not self._self_attached(toks, a) for a in find(toks, self.aggregate, "compensation")):
            found.setdefault("group", "compensation")

        for kind in PRIORITY:
            if kind not in found or (kind == "manager" and not manager_id):
                continue
            kind_out = "group" if kind == "team" and not is_manager else kind  # a colleague's "meu time" is their peers
            if kind_out in ("group", "company") and any(find(toks, [cue], "cue") for cue in self.rule_cues):
                return None  # a question about the rules ("como funciona o banco de horas da empresa?")
            if kind == "person":
                return Subject(kind_out, found[kind], person, None if person else shared_name)
            return Subject(kind_out, found[kind], manager_id if kind == "manager" else None)
        return None

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

    def _attached(self, toks: list[str], domains: list[Span], refs: list[Span], kind: str) -> str | None:
        """The domain of the first domain word attached to one of these people, if any."""
        for d in domains:
            question = " ".join(toks[d.start:d.end]) in QUESTION_FORMS
            for r in refs:
                if r.start < d.end and d.start < r.end:  # one phrase: "every salary", "todos os salarios"
                    return d.tag
                if r.start >= d.end:  # domain word, then the people
                    between = toks[d.end:r.start]
                    if question and len(between) <= MAX_QUESTION_GAP:
                        return d.tag
                    linked = any(t in self.links for t in between) or (not between and " ".join(toks[r.start:r.end]) in LINK_FREE)
                    if linked and len(between) <= MAX_LINK_GAP and all(t in self.between for t in between):
                        return d.tag
                else:  # the people, then the domain word: "my manager's salary", "team payroll"
                    between = toks[r.end:d.start]
                    if between == ["s"] or (not between and kind == "team" and toks[r.end - 1] == "team"):
                        return d.tag
        return None

    def _roles_after_question(self, toks: list[str], domains: list[Span]) -> list[Span]:
        """'quanto ganha um desenvolvedor sênior': a role after a pay question is a group."""
        questions = [d for d in domains if " ".join(toks[d.start:d.end]) in QUESTION_FORMS]
        return [r for r in find(toks, self.roles, "group") for q in questions if 0 <= r.start - q.end <= MAX_QUESTION_GAP]

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
