"""A message whose subject is not the speaker is never answered with the speaker's own data
(shared/eval/subject.yaml; the demo replays the same file). These are product requirements:
never relax a policy to make one pass."""

from __future__ import annotations

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.registry import execute, tool_catalog
from atrium.runtime.tool import ToolContext
from tests.security.test_agent_security import audit_events

pytestmark = [pytest.mark.db, pytest.mark.security]

CASES = yaml.safe_load((REPO_ROOT / "shared/eval/subject.yaml").read_text())
SELF_TOOLS = {name for name, meta in tool_catalog().items() if meta.get("subject") == "self"}


def own_data_tools(turn) -> list[str]:
    return [t["tool"] for t in turn.tools if t["tool"] in SELF_TOOLS and t["status"] in ("ok", "proposal")]


@pytest.mark.parametrize("item", CASES["refused"], ids=[c["q"][:60] for c in CASES["refused"]])
def test_request_about_someone_else_is_refused_before_any_tool(chat, owner_engine, item):
    before = len(audit_events(owner_engine, "authz.denied"))
    turn = chat(item["persona"], item["q"])
    assert turn.authz and not turn.authz["decision"]["allowed"], (turn.route, turn.text[:120])
    assert turn.authz["scope"] == item["kind"]
    assert not turn.tools and turn.route is None  # decided before routing: no model, no tool
    assert "Não posso" in turn.text
    assert len(audit_events(owner_engine, "authz.denied")) == before + 1


@pytest.mark.parametrize("item", CASES["allowed"], ids=[c["q"][:60] for c in CASES["allowed"]])
def test_allowed_request_about_others_is_answered_without_own_data(chat, item):
    turn = chat(item["persona"], item["q"])
    assert turn.route and turn.route["agents"] == [item["agent"]]
    assert not own_data_tools(turn), turn.tools


@pytest.mark.parametrize("item", CASES["own"], ids=[c["q"][:60] for c in CASES["own"]])
def test_mentioning_others_in_a_question_about_oneself_is_not_refused(chat, item):
    turn = chat(item["persona"], item["q"])
    assert turn.authz is None, turn.authz
    assert (turn.route or {}).get("method") != "subject_check", turn.route


@pytest.mark.parametrize("item", CASES["rules"], ids=[c["q"][:60] for c in CASES["rules"]])
def test_a_question_about_the_rules_is_answered_without_anyones_data(chat, item):
    turn = chat(item["persona"], item["q"])
    assert turn.authz is None and turn.route, (turn.authz, turn.route)
    assert not own_data_tools(turn), turn.tools


@pytest.mark.parametrize("item", CASES["unclear"], ids=[c["q"][:60] for c in CASES["unclear"]])
def test_unclear_whose_data_asks_before_reading_anything(chat, item):
    turn = chat(item["persona"], item["q"])
    chips = next((e["data"]["items"] for e in turn.events if e["event"] == "suggestions"), [])
    assert turn.route["mode"] == "clarify" and turn.route["method"] == "subject_check", turn.route
    assert not turn.tools and turn.authz is None
    assert len(chips) == 2 and chips[0].startswith("Ver o meu"), chips
    # The second chip names the other person explicitly: the policy engine refuses it, or the role
    # allows it and the subject check routes it; never the speaker's own data.
    follow = chat(item["persona"], chips[1])
    decided = follow.authz is not None or (follow.route or {}).get("method") == "subject_check"
    assert decided and not own_data_tools(follow), (chips[1], follow.authz, follow.route, follow.tools)


def test_self_service_tools_refuse_a_turn_about_someone_else(services, identity):
    """The hard guarantee under the detection: even if a router or a model picks a self-service
    tool for a question about the team, execute() does not read the speaker's data."""
    ctx = ToolContext(identity=identity("gestora"), services=services, agent_id="payroll", turn_subject="team")
    ex = execute(ctx, "payroll_get_payslip", {}, {"payroll_get_payslip"})
    assert ex.status == "denied" and ex.decision.policy == "subject_mismatch"
    assert ctx.subject_id is None
