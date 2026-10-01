"""Bring a database to a usable state: migrate, load the company, agents and knowledge."""

from __future__ import annotations

from sqlalchemy import create_engine, text

from atrium.agents.seed import seed_agents
from atrium.db.migrate import reset, upgrade
from atrium.kb.seed import seed_knowledge
from atrium.seed.history import seed_history
from atrium.seed.loader import seed


def bootstrap(owner_url: str, app_url: str, reset_schema: bool = False, with_knowledge: bool = True) -> dict:
    if reset_schema:
        reset(owner_url)
    else:
        upgrade(owner_url)
    result = {"hr": seed(owner_url), "agents": seed_agents(owner_url), "history": seed_history(owner_url)}
    if with_knowledge:
        result["knowledge"] = seed_knowledge(owner_url)
    return result


def is_seeded(owner_url: str) -> bool:
    """True when the schema exists and the fictional company is loaded (migrations still run)."""
    upgrade(owner_url)
    engine = create_engine(owner_url)
    with engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM hr.employees")).scalar_one()
    engine.dispose()
    return n > 0
