"""Deterministic lexical router (used by the fake model and ported to the static demo).

Scores each candidate agent's routing profile (keywords, example utterances, name and
description) with plural-insensitive phrase matches plus IDF-weighted token overlap, on the
text expanded by the shared lexicon (shared/catalog/lexicon.yaml). Candidates are only the
agents visible to the identity; an agent outside the list cannot be chosen.

Order of decisions: life event playbook, general-purpose request, request id (FER-...),
conversation follow-up, then scores. When no specialist is clearly ahead, the router asks
("Você quis dizer...") with the closest example question of each candidate instead of guessing.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from atrium.runtime.nlu import content_words, first_person, has_phrase, normalize, tokens
from atrium.text import fold

DIRECT_THRESHOLD = 1.5
CONFIDENT = 2.5
MULTI_MIN = 2.0
CLARIFY_MIN = 0.6
CONJUNCTIONS = (" e ", " tambem ", " alem disso ", ", e ", " mais ")
DECIDE_VERBS = re.compile(r"\b(aprov|recus|reprov|neg|rejeit|autoriz)\w*")
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
    def __init__(self, profiles: list[RoutingProfile], life_events: dict, lexicon: dict | None = None) -> None:
        self.profiles = {p.agent_id: p for p in profiles}
        self.life_events = life_events
        self.lexicon = lexicon or {}
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

    def _closest_example(self, text: str, agent_id: str) -> str:
        words = set(content_words(text))
        examples = self.profiles[agent_id].examples
        if not examples:
            return f"Sobre {self.profiles[agent_id].name}"
        return max(examples, key=lambda e: (len(words & set(content_words(e))) / (len(words | set(content_words(e))) or 1),
                                            -examples.index(e)))

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

        if not scored or scored[0][0] < DIRECT_THRESHOLD:
            weak = [a for s, a in scored if s >= CLARIFY_MIN][:3]
            if len(weak) >= 2:
                return self._clarify(text, weak, scores, "Sinal fraco para vários especialistas: perguntar antes de encaminhar.")
            return RouteDecision("direct", ["concierge"], "Nenhum especialista com sinal suficiente; o Concierge responde.", scores=scores)
        (s1, a1), (s2, a2) = scored[0], (scored[1] if len(scored) > 1 else (0.0, ""))
        padded = f" {f} "
        if s2 >= MULTI_MIN and s2 >= 0.6 * s1 and any(c in padded for c in CONJUNCTIONS):
            return RouteDecision("multi", [a1, a2], f"Pergunta composta: {self.profiles[a1].name} e {self.profiles[a2].name}.", scores=scores)
        if s1 < CONFIDENT and s2 >= 0.9 * s1:
            close = [a for s, a in scored if s >= 0.75 * s1][:3]
            return self._clarify(text, close, scores, "Pergunta ambígua entre especialistas.")
        return RouteDecision("single", [a1], f"Maior aderência ao perfil de {self.profiles[a1].name}.", scores=scores)
