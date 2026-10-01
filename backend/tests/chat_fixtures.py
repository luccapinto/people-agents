"""Fixtures to drive full chat turns through the orchestrator with the deterministic model."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from sqlalchemy import text

from atrium.authz.identity import load_identity
from atrium.config import Settings
from atrium.runtime.llm.fake import FakeProvider
from atrium.runtime.orchestrator import Orchestrator
from atrium.services import Services
from atrium.db.engine import Database
from tests.conftest import APP_URL, PERSONA


@dataclass
class Turn:
    events: list[dict]
    text: str
    conversation_id: str
    tools: list[dict] = field(default_factory=list)
    proposals: list[dict] = field(default_factory=list)
    cards: list[dict] = field(default_factory=list)
    route: dict | None = None
    guardrails: list[dict] = field(default_factory=list)
    authz: dict | None = None
    citations: list[dict] = field(default_factory=list)

    def tool(self, name: str) -> dict | None:
        return next((t for t in self.tools if t["tool"] == name), None)


@pytest.fixture(scope="session")
def services(seeded, owner_engine):
    # The suite sends hundreds of messages per persona; the rate limit has its own test.
    with owner_engine.begin() as c:
        c.execute(text("UPDATE app.policies SET value = '{\"value\": 100000}' WHERE key = 'user_rate_limit_per_minute'"))
        c.execute(text("UPDATE app.policies SET value = '{\"value\": 100000000}' WHERE key = 'user_daily_token_budget'"))
    settings = Settings(ATRIUM_DATABASE_URL=APP_URL, ATRIUM_LLM_PROVIDER="fake", ATRIUM_EMBEDDINGS="hash")
    s = Services(settings=settings, db=Database(APP_URL), llm=FakeProvider())
    s.policy.store.ttl_s = 0
    yield s
    s.db.dispose()


@pytest.fixture
def chat(services):
    def run(persona: str, message: str, conversation_id: str | None = None, attachments=None, playground=None) -> Turn:
        identity = load_identity(services.db, PERSONA.get(persona, persona))
        events = list(Orchestrator(services).run(identity, conversation_id, message, attachments, playground))
        t = Turn(events, "".join(e["data"]["delta"] for e in events if e["event"] == "text.delta"),
                 events[0]["data"]["conversation_id"])
        for e in events:
            d = e["data"]
            if e["event"] == "trace.tool":
                t.tools.append(d)
            elif e["event"] == "proposal":
                t.proposals.append(d)
            elif e["event"] == "card":
                t.cards.append(d["card"])
            elif e["event"] == "trace.route":
                t.route = d
            elif e["event"] == "trace.guardrail":
                t.guardrails.append(d)
            elif e["event"] == "trace.authz":
                t.authz = d
            elif e["event"] == "citation":
                t.citations.append(d)
        return t

    return run


@pytest.fixture
def identity(services):
    return lambda persona: load_identity(services.db, PERSONA.get(persona, persona))


@pytest.fixture(autouse=True)
def reset_mutable_state(request):
    """Remove rows created by confirmed proposals so tests stay independent of order."""
    yield
    if "owner_engine" not in request.fixturenames and "services" not in request.fixturenames and "chat" not in request.fixturenames:
        return
    engine = request.getfixturevalue("owner_engine")
    with engine.begin() as c:
        c.execute(text("DELETE FROM hr.vacation_requests WHERE id LIKE 'FER-5%'"))
        c.execute(text("DELETE FROM hr.leave_requests"))
        c.execute(text("DELETE FROM hr.plan_change_requests"))
        c.execute(text("DELETE FROM hr.time_adjustments"))
        runtime_deps = c.execute(text("SELECT id FROM hr.dependents WHERE length(id) = 7")).scalars().all()
        for d in runtime_deps:
            c.execute(text("UPDATE hr.benefit_enrollments SET dependents = dependents - :d"), {"d": d})
        c.execute(text("DELETE FROM hr.dependents WHERE length(id) = 7"))
        c.execute(text("DELETE FROM hr.reimbursements WHERE length(id) = 9"))
