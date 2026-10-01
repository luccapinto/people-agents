"""Deterministic lexical router (used by the fake model and ported to the static demo).

Scores each candidate agent's routing profile (keywords, example utterances, name and
description) with phrase matches plus IDF-weighted token overlap. Candidates are only the
agents visible to the identity; an agent outside the list cannot be chosen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from atrium.runtime.nlu import contains_phrase, tokens
from atrium.text import fold

DIRECT_THRESHOLD = 1.5
MULTI_MIN = 2.0
CONJUNCTIONS = (" e ", " tambem ", " alem disso ", ", e ", " mais ")


@dataclass(frozen=True)
class RoutingProfile:
    agent_id: str
    name: str
    description: str
    keywords: tuple[str, ...]
    examples: tuple[str, ...]


@dataclass
class RouteDecision:
    mode: str  # single | multi | clarify | direct | life_event | sensitive
    agents: list[str]
    reason: str
    method: str = "lexical"
    life_event: str | None = None
    scores: dict[str, float] = field(default_factory=dict)
    clarification: str | None = None

    def as_dict(self) -> dict:
        return {"mode": self.mode, "agents": self.agents, "reason": self.reason, "method": self.method,
                "life_event": self.life_event, "scores": {k: round(v, 2) for k, v in self.scores.items()},
                "clarification": self.clarification}


class LexicalRouter:
    def __init__(self, profiles: list[RoutingProfile], life_events: dict) -> None:
        self.profiles = {p.agent_id: p for p in profiles}
        self.life_events = life_events
        self._bags: dict[str, set[str]] = {}
        df: dict[str, int] = {}
        for p in profiles:
            bag = set(tokens(" ".join([p.name, p.description, *p.examples])))
            self._bags[p.agent_id] = bag
            for t in bag:
                df[t] = df.get(t, 0) + 1
        n = max(1, len(profiles))
        self._idf = {t: math.log(1 + n / c) for t, c in df.items()}

    def score(self, text: str, agent_id: str) -> float:
        p = self.profiles[agent_id]
        f = fold(text)
        s = 0.0
        for kw in p.keywords:
            if contains_phrase(f, kw):
                s += 2.0 + 0.5 * (len(kw.split()) - 1)
        overlap = set(tokens(text)) & self._bags[agent_id]
        s += 0.6 * sum(self._idf.get(t, 0.0) for t in sorted(overlap))
        return round(s, 4)

    def detect_life_event(self, text: str) -> str | None:
        f = fold(text)
        for key in sorted(self.life_events):
            if any(contains_phrase(f, kw) for kw in self.life_events[key]["keywords"]):
                return key
        return None

    def route(self, text: str, candidates: list[str]) -> RouteDecision:
        visible = [c for c in candidates if c in self.profiles]
        event = self.detect_life_event(text)
        if event:
            steps = [s["agent"] for s in self.life_events[event]["steps"]]
            agents = [a for i, a in enumerate(steps) if a in visible and a not in steps[:i]]
            if agents:
                return RouteDecision("life_event", agents, f"Evento de vida reconhecido: {self.life_events[event]['title']}.",
                                     life_event=event)
        scored = sorted(((self.score(text, a), a) for a in visible if a != "concierge"), key=lambda x: (-x[0], x[1]))
        scores = {a: s for s, a in scored if s > 0}
        if not scored or scored[0][0] < DIRECT_THRESHOLD:
            return RouteDecision("direct", ["concierge"], "Nenhum especialista com sinal suficiente; o Concierge responde.", scores=scores)
        (s1, a1), (s2, a2) = scored[0], (scored[1] if len(scored) > 1 else (0.0, ""))
        f = f" {fold(text)} "
        if s2 >= MULTI_MIN and s2 >= 0.6 * s1 and any(c in f for c in CONJUNCTIONS):
            return RouteDecision("multi", [a1, a2], f"Pergunta composta: {self.profiles[a1].name} e {self.profiles[a2].name}.", scores=scores)
        if s1 < 2.5 and s2 >= 0.9 * s1:
            n1, n2 = self.profiles[a1].name, self.profiles[a2].name
            return RouteDecision("clarify", [a1, a2], "Pergunta ambígua entre dois especialistas.", scores=scores,
                                 clarification=f"Você quer falar sobre {n1} ou sobre {n2}?")
        return RouteDecision("single", [a1], f"Maior aderência ao perfil de {self.profiles[a1].name}.", scores=scores)
