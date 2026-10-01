"""Deterministic router (used by the fake model and ported to the static demo).

Candidates are only the agents visible to the identity; an agent outside the list cannot be
chosen. Order of decisions: life event playbook, general-purpose request, request id (FER-...),
manager talking about the team, conversation follow-up, then the intent classifier
(``intent.py``) blended with each agent's lexical profile score (keywords, examples, name and
description). Agents the classifier was not trained on (created in the Agent Studio) are chosen by
their profile alone when it is clearly ahead. When no specialist is clearly ahead, the router asks
("Você quis dizer...") with the closest example question of each close candidate, never of an
unrelated one.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from atrium.runtime.intent import IntentModel
from atrium.runtime.nlu import (
    WORD,
    clauses,
    content_words,
    first_person,
    has_phrase,
    normalize,
    singular,
    tokens,
)
from atrium.text import fold

CONFIDENT = 2.5  # profile score of an agent the classifier does not know, to be chosen on it alone
# Frozen on routing.yaml (64), the owner phrases and the synthetic held-out split only, before any
# blind measurement: a heavier lexical share kept the tuning set at 59/64; margins did not change it.
BLEND = 1.5  # weight of the lexical profile score next to the classifier score
MARGIN = 1.0  # classifier margin for a direct decision
CLOSE = 0.6  # candidates within this of the top are offered when the margin is short
CLAUSE_MARGIN = 1.5  # per-clause margin over the main agent for a compound question to call a second specialist
CLAUSE_EVIDENCE = 2.0  # profile score of that clause for the second specialist: at least one of its keywords
CONJUNCTIONS = (" e ", " tambem ", " alem disso ", ", e ", " mais ")
DECIDE_VERBS = re.compile(r"\b(aprov|recus|reprov|neg|rejeit|autoriz)\w*")
# The next step every "not found" answer offers; the ticket carries the unanswered question.
TICKET_LABEL = "Abrir um chamado para o RH"
TICKET_CHIP = re.compile(r"\babrir um chamado para o rh\b")
GENERAL_LABELS = {"redacao": "redação de texto", "traducao": "tradução", "resumo": "resumo", "revisao": "revisão de texto",
                  "codigo": "programação", "conhecimento geral": "conhecimento geral"}
# Asking how to do something ("como escrevo a justificativa?") is a question for a specialist,
# not a request for the assistant to write.
HOW_TO = re.compile(r"\bcomo\s+(?:eu\s+)?(?:escrev|redij|tradu|resum|revis|corrij|elabor|mont|cri)\w*")


@dataclass(frozen=True)
class RoutingProfile:
    agent_id: str
    name: str
    description: str
    keywords: tuple[str, ...]
    examples: tuple[str, ...]


@dataclass
class RouteDecision:
    mode: str  # single | multi | clarify | direct | general | life_event | sensitive
    agents: list[str]
    reason: str
    method: str = "lexical"
    life_event: str | None = None
    scores: dict[str, float] = field(default_factory=dict)
    clarification: str | None = None
    suggestions: list[str] = field(default_factory=list)
    general: str | None = None

    def as_dict(self) -> dict:
        return {"mode": self.mode, "agents": self.agents, "reason": self.reason, "method": self.method,
                "life_event": self.life_event, "scores": {k: round(v, 2) for k, v in self.scores.items()},
                "clarification": self.clarification}


YEAR = re.compile(r"\b20\d{2}\b|\b(?:esse|este|neste|nesse|no)\s+ano\b")
CLOCK = re.compile(r"\b\d{1,2}h(?:\d{2})?\b|\b\d{1,2}:\d{2}\b")


def expand(text: str, synonyms: dict[str, list[str]]) -> str:
    """Normalized text with lexicon variants replaced by their canonical term, followed by the
    original normalized text (so both the canonical and the literal words can match). A year
    adds the word "ano" and a clock time ("9h", "18:30") the word "horario"."""
    original = normalize(text)
    out = f" {original} "
    pairs = sorted(((normalize(v), normalize(c)) for c, vs in synonyms.items() for v in vs), key=lambda p: -len(p[0]))
    for variant, canonical in pairs:
        if variant and f" {variant} " in out:
            out = out.replace(f" {variant} ", f" {canonical} ")
    folded = fold(text)
    cues = [w for w, rx in (("ano", YEAR), ("horario", CLOCK)) if rx.search(folded)]
    out = " ".join([out.strip(), *cues])
    return out if out == original else f"{out} ‖ {original}"


class LexicalRouter:
    def __init__(self, profiles: list[RoutingProfile], life_events: dict, lexicon: dict | None, model: IntentModel) -> None:
        self.profiles = {p.agent_id: p for p in profiles}
        self.life_events = life_events
        self.lexicon = lexicon or {}
        self.model = model
        self.synonyms: dict[str, list[str]] = self.lexicon.get("synonyms", {})
        self.containers = {normalize(c) for c in self.lexicon.get("containers", [])}
        self._bags: dict[str, set[str]] = {}
        df: dict[str, int] = {}
        for p in profiles:
            bag = set(tokens(" ".join([p.name, p.description, *p.examples])))
            self._bags[p.agent_id] = bag
            for t in bag:
                df[t] = df.get(t, 0) + 1
        n = max(1, len(profiles))
        self._idf = {t: math.log(1 + n / c) for t, c in df.items()}

    def expanded(self, text: str) -> str:
        return expand(text, self.synonyms)

    def score(self, text: str, agent_id: str, expanded: str | None = None) -> float:
        p = self.profiles[agent_id]
        n = expanded if expanded is not None else self.expanded(text)
        s = 0.0
        for kw in p.keywords:
            if has_phrase(n, kw):
                s += 0.75 if normalize(kw) in self.containers else 2.0 + 0.5 * (len(kw.split()) - 1)
        overlap = set(tokens(n)) & self._bags[agent_id]
        s += 0.6 * sum(self._idf.get(t, 0.0) for t in sorted(overlap))
        return round(s, 4)

    def detect_life_event(self, text: str, expanded: str | None = None) -> str | None:
        n = expanded if expanded is not None else self.expanded(text)
        for key in sorted(self.life_events):
            if any(has_phrase(n, kw) for kw in self.life_events[key]["keywords"]):
                return key
        return None

    def general_kind(self, text: str, expanded: str | None = None) -> str | None:
        n = expanded if expanded is not None else self.expanded(text)
        for kind, phrases in self.lexicon.get("general", {}).items():
            if any(has_phrase(n, ph) for ph in phrases):
                if kind in ("redacao", "traducao", "resumo", "revisao") and HOW_TO.search(fold(text)):
                    continue
                return kind
        return None

    def _closest_examples(self, text: str, agent_id: str) -> list[str]:
        """The agent's example questions, closest to the text first."""
        words = set(content_words(text))
        examples = self.profiles[agent_id].examples
        return sorted(examples, key=lambda e: (-(len(words & set(content_words(e))) / (len(words | set(content_words(e))) or 1)),
                                               examples.index(e)))

    def _closest_example(self, text: str, agent_id: str) -> str:
        ranked = self._closest_examples(text, agent_id)
        return ranked[0] if ranked else f"Sobre {self.profiles[agent_id].name}"

    def next_steps(self, text: str, visible: list[str], agent_id: str) -> list[str]:
        """Chips for an answer that found nothing: questions of the probable domain the assistant can
        answer (the agent's own, or for the Concierge the closest specialists'), then the HR ticket."""
        if agent_id != "concierge" and agent_id in self.profiles:
            options = self._closest_examples(text, agent_id)
        else:
            near = [a for _s, a in self.blended(text, visible, {a: self.score(text, a) for a in visible}) if a != "concierge"][:2]
            options = [self._closest_example(text, a) for a in near]
        return [o for o in options if fold(o) != fold(text)][:2] + [TICKET_LABEL]

    def _clarify(self, text: str, agents: list[str], scores: dict, reason: str) -> RouteDecision:
        return RouteDecision("clarify", agents, reason, scores=scores, clarification="Você quis dizer...",
                             suggestions=[self._closest_example(text, a) for a in agents])

    def route(self, text: str, candidates: list[str], previous: list[str] | None = None) -> RouteDecision:
        visible = [c for c in candidates if c in self.profiles]
        n = self.expanded(text)
        event = self.detect_life_event(text, n)
        if event:
            steps = [s["agent"] for s in self.life_events[event]["steps"]]
            agents = [a for i, a in enumerate(steps) if a in visible and a not in steps[:i]]
            if agents:
                return RouteDecision("life_event", agents, f"Evento de vida reconhecido: {self.life_events[event]['title']}.",
                                     life_event=event)
        scored = sorted(((self.score(text, a, n), a) for a in visible if a != "concierge"), key=lambda x: (-x[0], x[1]))
        best = scored[0][0] if scored else 0.0

        general = self.general_kind(text, n)
        if general and "concierge" in visible and (general not in ("codigo", "conhecimento geral") or best < CONFIDENT):
            return RouteDecision("general", ["concierge"], f"Pedido de uso geral ({GENERAL_LABELS[general]}): o Concierge responde.",
                                 general=general)

        f = fold(text)
        rid = re.search(r"\bfer-\d+\b", f)
        if rid:
            if DECIDE_VERBS.search(f) and "leadership" in visible:
                return RouteDecision("single", ["leadership"], f"Decisão sobre o pedido {rid.group(0).upper()}.")
            if "vacation" in visible:
                return RouteDecision("single", ["vacation"], f"Pedido de férias {rid.group(0).upper()}.")

        scores = {a: s for s, a in scored if s > 0}
        if "leadership" in visible:
            # A manager talking about the team ("eles", "minha equipe") or about deciding something
            # ("esperando eu aprovar") is asking Liderança, whatever else the sentence mentions.
            team = [normalize(x) for x in self.lexicon.get("team_reference", []) if has_phrase(n, x)]
            rest = f" {normalize(text)} "
            for phrase in team:
                rest = rest.replace(f" {phrase} ", " ")
            if any(has_phrase(n, x) for x in self.lexicon.get("approval_by_me", [])) or (team and not first_person(rest)):
                return RouteDecision("single", ["leadership"], "Pergunta sobre o time da pessoa gestora.", scores=scores)

        # A short follow-up without a subject of its own ("e de hora extra?") stays with the specialist
        # of the previous turn in the same conversation.
        prev = previous[0] if previous and len(previous) == 1 else None
        if prev and prev in visible and prev != "concierge" and scores.get(prev, 0) > 0 and not first_person(text) \
                and len(content_words(text)) <= 8:
            return RouteDecision("single", [prev], f"Continuação da conversa com {self.profiles[prev].name}.", scores=scores)

        return self._classified(text, visible, scored, scores)

    def blended(self, text: str, visible: list[str], lexical: dict[str, float]) -> list[tuple[float, str]]:
        """Visible agents the classifier knows, by classifier score plus a share of the profile score.
        Container words ("o documento do meu holerite") are generic, so the classifier does not read them."""
        kept = [w for w in WORD.findall(fold(text)) if singular(w) not in self.containers]
        clf = self.model.scores(" ".join(kept))
        out = [(round(clf[a] + BLEND * lexical.get(a, 0.0), 6), a) for a in visible if a in clf]
        return sorted(out, key=lambda x: (-x[0], x[1]))

    def _classified(self, text: str, visible: list[str], scored: list[tuple[float, str]], scores: dict) -> RouteDecision:
        lexical = {a: s for s, a in scored}
        ranked = self.blended(text, visible, lexical)
        # An agent the classifier never saw (Agent Studio) wins on its own profile when clearly ahead.
        unknown = [(s, a) for s, a in scored if a not in self.model.classes]
        known_best = max((s for s, a in scored if a in self.model.classes), default=0.0)
        if unknown and unknown[0][0] >= CONFIDENT and unknown[0][0] > known_best:
            a = unknown[0][1]
            return RouteDecision("single", [a], f"Maior aderência ao perfil de {self.profiles[a].name}.", scores=scores)
        if not ranked:  # only agents the classifier does not know, none clearly ahead
            return RouteDecision("direct", ["concierge"], "Nenhum especialista com sinal suficiente; o Concierge responde.", scores=scores)
        s1, a1 = ranked[0]
        s2 = ranked[1][0] if len(ranked) > 1 else s1 - 2 * MARGIN
        # A compound question: another specialist only for a clause the main one clearly cannot answer.
        if any(c in f" {fold(text)} " for c in CONJUNCTIONS):
            asked: list[str] = [a1] if a1 != "concierge" else []
            for clause in clauses(text):
                if len(content_words(clause)) < 2:
                    continue
                lexical_clause = {a: self.score(clause, a) for a in visible}
                ranked_clause = self.blended(clause, visible, lexical_clause)
                part = {a: s for s, a in ranked_clause}
                top = ranked_clause[0][1] if ranked_clause else "concierge"
                # The clause must name the second topic itself ("e quantos dias de férias"), not lean on a prior.
                if top != "concierge" and top not in asked and lexical_clause.get(top, 0.0) >= CLAUSE_EVIDENCE \
                        and part[top] - part.get(a1, part[top]) >= CLAUSE_MARGIN:
                    asked.append(top)
            if len(asked) >= 2:
                agents = asked[:3]
                return RouteDecision("multi", agents, "Pergunta composta: " + " e ".join(self.profiles[a].name for a in agents) + ".",
                                     scores=scores)
        if a1 == "concierge":
            return RouteDecision("direct", ["concierge"], "Pergunta geral: o Concierge responde.", scores=scores)
        if s1 - s2 >= MARGIN:
            return RouteDecision("single", [a1], f"Classificado como {self.profiles[a1].name}.", scores=scores)
        close = [a for s, a in ranked if s >= s1 - CLOSE and a != "concierge"][:3]
        if len(close) >= 2:
            return self._clarify(text, close, scores, "Pergunta ambígua entre especialistas.")
        return RouteDecision("single", [a1], f"Classificado como {self.profiles[a1].name}.", scores=scores)
