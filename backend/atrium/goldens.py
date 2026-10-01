"""Golden fixtures for the static demo engine (shared/generated/goldens.json).

Replays shared/eval/golden_scenarios.yaml through the real orchestrator with the
deterministic model on a freshly seeded database, and records what the demo must
reproduce. Also records routing decisions for the routing eval set and a matrix of
policy-engine decisions.
"""

from __future__ import annotations

import os

import yaml
from sqlalchemy import create_engine, text

from atrium.config import REPO_ROOT, Settings

SCENARIOS = REPO_ROOT / "shared/eval/golden_scenarios.yaml"
ACTIONS = ["self.payroll.read", "team.vacation.read", "team.compensation.read", "team.vacation.decide", "analytics.aggregate"]


RANDOM_KEYS = {"verification_code", "document_id", "pdf_url"}  # issued documents get fresh codes


def _scrub(value):
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if k not in RANDOM_KEYS}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _turn(events: list[dict]) -> dict:
    out: dict = {"tools": [], "cards": [], "proposals": [], "guardrails": [], "route": None, "authz": None, "text": "", "error": None}
    for e in events:
        d = e["data"]
        kind = e["event"]
        if kind == "trace.route":
            out["route"] = {"mode": d["mode"], "agents": d["agents"], "life_event": d.get("life_event")}
        elif kind == "trace.tool":
            out["tools"].append({"tool": d["tool"], "args": d["args"], "status": d["status"],
                                 "allowed": d["decision"]["allowed"], "policy": d["decision"]["policy"]})
        elif kind == "card":
            out["cards"].append(_scrub(d["card"]))
        elif kind == "proposal":
            out["proposals"].append({"tool": d["tool"], "summary": d["summary"], "details": d["details"], "risk": d["risk"],
                                     "step_up_required": d["step_up_required"]})
        elif kind == "trace.guardrail":
            out["guardrails"].append({"name": d["name"], "stage": d["stage"], "outcome": d["outcome"]})
        elif kind == "trace.authz":
            out["authz"] = {"subject": d["subject"], "action": d["action"], "allowed": d["decision"]["allowed"],
                            "policy": d["decision"]["policy"]}
        elif kind == "text.delta":
            out["text"] += d["delta"]
        elif kind == "error":
            out["error"] = d["code"]
    return out


def _round2_items() -> list[dict]:
    ev = REPO_ROOT / "shared/eval"
    owner = yaml.safe_load((ev / "owner-phrases.yaml").read_text())
    return [*owner["owner"], *owner["visitor"], *yaml.safe_load((ev / "out-of-domain.yaml").read_text())["questions"],
            *yaml.safe_load((ev / "injection.yaml").read_text())["attempts"],
            *yaml.safe_load((ev / "injection-benign.yaml").read_text())["messages"]]


def build_goldens(owner_url: str | None = None, app_url: str | None = None) -> dict:
    """Needs a disposable database (the test database by default): it is reset and seeded."""
    from atrium.authz.identity import load_identity
    from atrium.bootstrap import bootstrap
    from atrium.db.engine import Database
    from atrium.runtime.agents import lexicon, life_events
    from atrium.runtime.llm.fake import FakeProvider
    from atrium.runtime.orchestrator import Orchestrator
    from atrium.runtime.router import LexicalRouter
    from atrium.seed.loader import load_dataset
    from atrium.services import Services

    os.environ["ATRIUM_TODAY"] = "2026-10-01"
    owner_url = owner_url or os.environ.get("ATRIUM_TEST_OWNER_URL", "postgresql+psycopg://atrium_owner:atrium_owner@localhost:55432/atrium_test")
    app_url = app_url or os.environ.get("ATRIUM_TEST_APP_URL", "postgresql+psycopg://atrium_app:atrium_app@localhost:55432/atrium_test")
    bootstrap(owner_url, app_url, reset_schema=True, with_knowledge=True)
    engine = create_engine(owner_url)
    with engine.begin() as c:
        c.execute(text("UPDATE app.policies SET value = '{\"value\": 100000}' WHERE key = 'user_rate_limit_per_minute'"))
    engine.dispose()
    s = Services(settings=Settings(ATRIUM_DATABASE_URL=app_url, ATRIUM_EMBEDDINGS="hash"), db=Database(app_url), llm=FakeProvider())
    persona = {p["key"]: p["employee_id"] for p in load_dataset()["personas"]}
    who = {k: load_identity(s.db, v) for k, v in persona.items()}

    conversations: dict[str, str] = {}
    turns = []
    for sc in yaml.safe_load(SCENARIOS.read_text())["scenarios"]:
        events = list(Orchestrator(s).run(who[sc["persona"]], None, sc["q"]))
        turns.append({"persona": sc["persona"], "q": sc["q"], **_turn(events)})
    # The owner's phrases, the out-of-domain questions and the injection sets, replayed the same
    # way; consecutive items with the same "conversation" key share one conversation.
    for item in _round2_items():
        conversation = conversations.get(item.get("conversation"))
        events = list(Orchestrator(s).run(who[item["persona"]], conversation, item["q"]))
        if item.get("conversation"):
            conversations[item["conversation"]] = events[0]["data"]["conversation_id"]
        turns.append({"persona": item["persona"], "q": item["q"], "conversation": item.get("conversation"), **_turn(events)})

    routing = []
    for name in ("routing.yaml", "routing-blind.yaml"):
        for item in yaml.safe_load((REPO_ROOT / "shared/eval" / name).read_text())["questions"]:
            visible = s.agents.visible_for(who[item["persona"]])
            d = LexicalRouter([a.profile() for a in visible], life_events(), lexicon()).route(item["q"], [a.id for a in visible])
            routing.append({"persona": item["persona"], "q": item["q"], "mode": d.mode, "agents": d.agents, "life_event": d.life_event,
                            "visible": [a.id for a in visible]})

    data = load_dataset()
    subjects = {"self": None, "report": persona["colaborador"], "outsider": next(e["id"] for e in data["employees"] if e["name"] == "Maria Oliveira")}
    decisions = []
    for pk, ident in who.items():
        for action in ACTIONS:
            for label, subject in subjects.items():
                subj = ident.employee_id if subject is None else subject
                kwargs = {"unit_ids": ["U11"], "all_units": data["units"]} if action == "analytics.aggregate" else {}
                dec = s.policy.authorize(ident, action, None if action == "analytics.aggregate" else subj, **kwargs)
                decisions.append({"persona": pk, "action": action, "subject": label, "allowed": dec.allowed, "policy": dec.policy})
    s.db.dispose()
    return {"today": "2026-10-01", "turns": turns, "routing": routing, "decisions": decisions}
