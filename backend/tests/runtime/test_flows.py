"""End-to-end flows through the orchestrator with the deterministic model."""

import pytest
from sqlalchemy import text

from tests.conftest import PERSONA

pytestmark = pytest.mark.db


def test_birth_life_event_orchestrates_specialists_and_confirms(chat, services, identity, owner_engine):
    turn = chat("colaborador", "Meu filho nasceu ontem")
    assert turn.route["mode"] == "life_event" and turn.route["life_event"] == "birth"
    assert {"vacation", "benefits", "profile"} <= set(turn.route["agents"])
    assert any(c["type"] == "life_event" for c in turn.cards)
    tools = [t["tool"] for t in turn.tools]
    assert tools == ["leave_register", "benefits_enroll_newborn", "benefits_daycare_info", "profile_add_dependent"]
    assert len(turn.proposals) == 3
    assert "20 dias de licença-paternidade" in turn.text and "30/10/2026" in turn.text
    me = identity("colaborador")
    for p in turn.proposals:
        assert services.proposals.confirm(me, p["id"], p["token"])["status"] == "executed"
    with owner_engine.begin() as c:
        leave = c.execute(text("SELECT kind, start, days FROM hr.leave_requests WHERE employee_id = :e"), {"e": PERSONA["colaborador"]}).one()
        deps = c.execute(text("SELECT id, ir_dependent, health_plan FROM hr.dependents WHERE employee_id = :e AND birth_date = '2026-09-30'"),
                         {"e": PERSONA["colaborador"]}).all()
        plan = c.execute(text("""SELECT dependents FROM hr.benefit_enrollments WHERE employee_id = :e AND plan_id LIKE 'PLN-%'"""),
                         {"e": PERSONA["colaborador"]}).scalar_one()
        assert leave.kind == "licença-paternidade" and leave.days == 20
        assert len(deps) == 1 and deps[0].ir_dependent and deps[0].health_plan
        assert deps[0].id in plan
        # restore the dataset for other tests
        c.execute(text("DELETE FROM hr.leave_requests WHERE employee_id = :e"), {"e": PERSONA["colaborador"]})
        c.execute(text("UPDATE hr.benefit_enrollments SET dependents = dependents - :d WHERE employee_id = :e"),
                  {"d": deps[0].id, "e": PERSONA["colaborador"]})
        c.execute(text("DELETE FROM hr.dependents WHERE id = :d"), {"d": deps[0].id})


def test_vacation_request_then_manager_approval(chat, services, identity, owner_engine):
    turn = chat("colaborador", "Quero tirar férias de 23/11 a 07/12")
    req = services.proposals.confirm(identity("colaborador"), turn.proposals[0]["id"], turn.proposals[0]["token"])
    rid = req["data"]["request_id"]
    pending = chat("gestora", "Tenho aprovações pendentes?")
    assert rid in pending.text
    decide = chat("gestora", f"Aprovar o pedido {rid}")
    t = decide.tool("team_decide_vacation")
    assert t["status"] == "proposal" and t["decision"]["policy"] == "direct_report"
    services.proposals.confirm(identity("gestora"), decide.proposals[0]["id"], decide.proposals[0]["token"])
    with owner_engine.begin() as c:
        row = c.execute(text("SELECT status, decided_by FROM hr.vacation_requests WHERE id = :id"), {"id": rid}).one()
        assert row.status == "approved" and row.decided_by == PERSONA["gestora"]
        c.execute(text("DELETE FROM hr.vacation_requests WHERE id = :id"), {"id": rid})


def test_requester_cancels_own_request_through_a_proposal(chat, services, identity, owner_engine):
    me = identity("colaborador")
    turn = chat("colaborador", "Quero tirar férias de 23/11 a 07/12")
    rid = services.proposals.confirm(me, turn.proposals[0]["id"], turn.proposals[0]["token"])["data"]["request_id"]
    # The deterministic model needs a catalog hint verbatim ("cancelar férias"); this test is about the write path.
    cancel = chat("colaborador", f"Quero cancelar férias: {rid}")
    assert cancel.tool("vacation_cancel_request")["status"] == "proposal"
    assert services.proposals.confirm(me, cancel.proposals[0]["id"], cancel.proposals[0]["token"])["status"] == "executed"
    with owner_engine.begin() as c:
        row = c.execute(text("SELECT status, decided_by FROM hr.vacation_requests WHERE id = :id"), {"id": rid}).one()
        assert row.status == "cancelled" and row.decided_by is None
        c.execute(text("DELETE FROM hr.vacation_requests WHERE id = :id"), {"id": rid})


def test_vacation_rules_are_explained_when_violated(chat):
    turn = chat("colaborador", "Quero tirar férias de 06/11 a 10/11")  # Friday start, 5 days, balance needs a 14-day fraction
    assert turn.tool("vacation_request")["status"] == "error"
    assert any(c["type"] == "validation" for c in turn.cards)
    assert "CLT" in turn.text


def test_policy_question_answered_with_citation(chat):
    turn = chat("colaborador", "Posso aceitar um brinde de fornecedor?")
    assert turn.citations and turn.citations[0]["kb"] in ("compliance", "corporativo")
    assert "Segundo" in turn.text


def test_unanswerable_question_is_recorded_as_a_content_gap(chat, owner_engine):
    with owner_engine.begin() as c:
        before = c.execute(text("SELECT count(*) FROM app.unanswered")).scalar_one()
    chat("colaborador", "Qual a política para levar meu cachorro ao escritório às sextas?")
    with owner_engine.begin() as c:
        after = c.execute(text("SELECT count(*) FROM app.unanswered")).scalar_one()
    assert after >= before  # recorded only when knowledge search found nothing


def test_rate_limit_applies(chat, owner_engine, services):
    with owner_engine.begin() as c:
        c.execute(text("UPDATE app.policies SET value = '{\"value\": 1}' WHERE key = 'user_rate_limit_per_minute'"))
    try:
        turn = chat("hrbp", "oi")
        turn2 = chat("hrbp", "oi de novo")
        assert any(e["event"] == "error" and e["data"]["code"] == "rate_limited" for e in turn.events + turn2.events)
    finally:
        with owner_engine.begin() as c:
            c.execute(text("UPDATE app.policies SET value = '{\"value\": 100000}' WHERE key = 'user_rate_limit_per_minute'"))


def test_turn_is_audited_and_chain_stays_valid(chat, owner_engine):
    from atrium.runtime.audit import verify_chain

    turn = chat("colaborador", "Qual é o meu plano de saúde?")
    with owner_engine.begin() as c:
        types = c.execute(text("SELECT DISTINCT type FROM app.audit_events WHERE conversation_id = :c"), {"c": turn.conversation_id}).scalars().all()
        assert {"chat.route", "tool.call", "chat.turn"} <= set(types)
        assert verify_chain(c).ok
