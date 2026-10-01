"""Agents: specs from the database (built-ins seeded from the catalog, Agent Studio agents),
filtered by audience and lifecycle for each identity."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import yaml
from sqlalchemy import text

from atrium.authz.identity import IdentityContext
from atrium.config import REPO_ROOT
from atrium.db.engine import Database
from atrium.runtime.router import RoutingProfile


@lru_cache(maxsize=1)
def agent_catalog() -> dict:
    return yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())


@lru_cache(maxsize=1)
def life_events() -> dict:
    return yaml.safe_load((REPO_ROOT / "shared/catalog/life_events.yaml").read_text())["events"]


@dataclass
class AgentSpec:
    id: str
    name: str
    description: str
    instructions: str
    tools: list[str]
    knowledge: list[str]
    audience: dict
    icon: str = "bot"
    keywords: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)
    status: str = "published"
    version: int = 1
    owner_id: str | None = None
    builtin: bool = True
    origin: str = "catalog"
    evaluation: list[dict] = field(default_factory=list)
    tone: str = ""

    @classmethod
    def from_spec(cls, agent_id: str, spec: dict, **meta) -> AgentSpec:
        routing = spec.get("routing") or {}
        return cls(
            id=agent_id, name=spec["name"], description=spec["description"], instructions=spec.get("instructions", ""),
            tools=list(spec.get("tools", [])), knowledge=list(spec.get("knowledge", [])),
            audience=spec.get("audience") or {"type": "all"}, icon=spec.get("icon", "bot"),
            keywords=list(routing.get("keywords", [])), examples=list(routing.get("examples", [])),
            evaluation=list(spec.get("evaluation", [])), tone=spec.get("tone", ""), origin=spec.get("origin", "catalog"), **meta,
        )

    def profile(self) -> RoutingProfile:
        return RoutingProfile(self.id, self.name, self.description, tuple(self.keywords), tuple(self.examples))

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "description": self.description, "icon": self.icon, "status": self.status,
                "version": self.version, "builtin": self.builtin, "origin": self.origin, "audience": self.audience,
                "tools": self.tools, "knowledge": self.knowledge}


def audience_allows(audience: dict, identity: IdentityContext) -> bool:
    kind = audience.get("type", "all")
    if kind == "all":
        return True
    if kind == "roles":
        return bool(set(audience.get("roles", [])) & identity.roles)
    if kind == "units":
        return bool(set(audience.get("units", [])) & set(identity.unit_path))
    return False


class AgentDirectory:
    def __init__(self, db: Database) -> None:
        self.db = db

    def _rows(self, identity: IdentityContext) -> list[AgentSpec]:
        with self.db.scoped(identity.employee_id) as c:
            rows = c.execute(text(
                """SELECT a.id, a.status, a.owner_id, a.builtin, a.published_version,
                          v.version, v.spec, v.status AS vstatus
                   FROM app.agents a
                   JOIN LATERAL (
                       SELECT version, spec, status FROM app.agent_versions av
                       WHERE av.agent_id = a.id AND (av.version = a.published_version OR a.published_version IS NULL)
                       ORDER BY version DESC LIMIT 1) v ON true
                   ORDER BY a.builtin DESC, a.id""")).all()
        return [AgentSpec.from_spec(r.id, r.spec, status=r.status, version=r.version, owner_id=r.owner_id, builtin=r.builtin) for r in rows]

    def visible_for(self, identity: IdentityContext) -> list[AgentSpec]:
        """Published agents whose audience includes this identity (drafts never appear here)."""
        return [a for a in self._rows(identity) if a.status == "published" and audience_allows(a.audience, identity)]

    def get(self, agent_id: str, identity: IdentityContext) -> AgentSpec | None:
        return next((a for a in self.visible_for(identity) if a.id == agent_id), None)

    def draft_for_owner(self, agent_id: str, identity: IdentityContext) -> AgentSpec | None:
        """Latest version (any status) of an agent the identity owns, used by the playground and evaluation."""
        with self.db.scoped(identity.employee_id) as c:
            r = c.execute(text(
                """SELECT a.id, a.status, a.owner_id, a.builtin, v.version, v.spec FROM app.agents a
                   JOIN app.agent_versions v ON v.agent_id = a.id
                   WHERE a.id = :id AND a.owner_id = :me ORDER BY v.version DESC LIMIT 1"""),
                {"id": agent_id, "me": identity.employee_id}).first()
        if r is None:
            return None
        return AgentSpec.from_spec(r.id, r.spec, status="playground", version=r.version, owner_id=r.owner_id, builtin=r.builtin)
