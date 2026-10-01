"""Bring a database to a usable state: migrate, load the company, agents and knowledge."""

from __future__ import annotations

from atrium.db.migrate import reset, upgrade
from atrium.seed.loader import seed


def bootstrap(owner_url: str, app_url: str, reset_schema: bool = False, with_knowledge: bool = True) -> dict:
    if reset_schema:
        reset(owner_url)
    else:
        upgrade(owner_url)
    result = {"hr": seed(owner_url)}
    try:
        from atrium.agents.seed import seed_agents
    except ImportError:  # pragma: no cover - agents arrive with the runtime
        return result
    result["agents"] = seed_agents(owner_url)
    if with_knowledge:
        from atrium.kb.seed import seed_knowledge

        result["knowledge"] = seed_knowledge(owner_url)
    return result
