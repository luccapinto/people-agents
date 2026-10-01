"""End-to-end flows through the orchestrator with the deterministic model."""

from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from atrium.tools.leadership import DecideArgs, _decide_candidates, team_decide_vacation
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


@pytest.mark.parametrize("expense,category,note", [("almoco", None, True), ("jantar viagem", "alimentação em viagem", False),
                                                   ("uber viagem", "transporte por aplicativo", False), ("hotel", "hospedagem", False)])
def test_reimbursement_guide_counts_a_meal_only_during_a_trip(expense, category, note):
    from atrium.tools._util import company_policies
    from atrium.tools.reimbursement import guide_category

    assert guide_category(expense, company_policies()["reimbursement"]) == (category, note)


def test_unanswerable_question_is_recorded_as_a_content_gap(chat, owner_engine):
    with owner_engine.begin() as c:
        before = c.execute(text("SELECT count(*) FROM app.unanswered")).scalar_one()
    chat("colaborador", "Qual a política para levar meu cachorro ao escritório às sextas?")
    with owner_engine.begin() as c:
        after = c.execute(text("SELECT count(*) FROM app.unanswered")).scalar_one()
    assert after >= before  # recorded only when knowledge search found nothing


def _suggestions(turn) -> list[str]:
    return next((e["data"]["items"] for e in turn.events if e["event"] == "suggestions"), [])


def test_a_question_nobody_answers_offers_next_steps_and_an_hr_ticket(chat):
    turn = chat("colaborador", "Qual a política para levar meu cachorro ao escritório às sextas?")
    chips = _suggestions(turn)
    assert turn.tool("kb_search")["status"] == "error" and 2 <= len(chips) <= 3 and chips[-1] == "Abrir um chamado para o RH"
    ticket = chat("colaborador", chips[-1], conversation_id=turn.conversation_id)
    assert ticket.proposals and ticket.proposals[0]["tool"] == "ticket_open"
    assert any("cachorro" in str(d["value"]) for d in ticket.proposals[0]["details"])  # the ticket carries the question


def test_a_month_without_a_valid_window_shows_the_nearest_windows(chat):
    turn = chat("colaborador", "quero tirar férias em abril")  # the period must be used by 03/03/2027
    card = next(c for c in turn.cards if c["type"] == "vacation_calendar")
    assert "Em abril não há janela válida" in turn.text and "03/03/2027" in turn.text
    assert len(card["data"]["windows"]) == 3 and _suggestions(turn)


def test_a_month_in_range_lists_windows_that_start_in_it(chat):
    turn = chat("colaborador", "quero tirar férias em fevereiro")
    windows = next(c for c in turn.cards if c["type"] == "vacation_calendar")["data"]["windows"]
    assert windows and all(w["start"][5:7] == "02" for w in windows), windows
    assert "não há janela válida" not in turn.text


def test_a_window_that_would_pass_the_deadline_says_so(chat):
    turn = chat("colaborador", "quero tirar 20 dias de férias em março")  # 01/03 + 20 days ends after 03/03/2027
    assert "Em março não há janela válida: o saldo deste período precisa ser usado até 03/03/2027" in turn.text, turn.text


def test_manager_decides_a_request_by_the_first_name(chat):
    turn = chat("gestora", "aprova as férias do Tiago")
    assert turn.route["agents"] == ["leadership"]
    assert turn.proposals and turn.proposals[0]["tool"] == "team_decide_vacation" and "Tiago Bezerra" in turn.proposals[0]["summary"]
    none_pending = chat("gestora", "recusa o pedido de férias da Camila")
    assert "não tem pedido de férias aguardando" in none_pending.text and _suggestions(none_pending)


@pytest.mark.parametrize("q", ["as férias da Camila já foram aprovadas?", "a aprovação das férias do Tiago saiu?",
                               "o Tiago negociou as férias com o cliente?"])
def test_a_question_about_a_decision_is_not_a_decision(chat, q):
    turn = chat("gestora", q)
    assert not any(p["tool"] == "team_decide_vacation" for p in turn.proposals), turn.proposals
    assert not turn.tool("team_decide_vacation"), turn.tools


def test_a_first_name_two_direct_reports_share_asks_whose_request():
    """The seed has no shared first names in one team, so the directory is faked here."""
    camilas = [SimpleNamespace(id="A", name="Camila Martins"), SimpleNamespace(id="B", name="Camila Souza"),
               SimpleNamespace(id="C", name="Camila Prado")]  # C is not a direct report
    pending = {"A": [SimpleNamespace(id="FER-1", status="pending_manager")], "B": [SimpleNamespace(id="FER-2", status="pending_manager")]}
    hr = SimpleNamespace(directory=SimpleNamespace(search=lambda name, limit=10: camilas),
                         vacation=SimpleNamespace(requests=lambda eid: pending.get(eid, [])))
    ctx = SimpleNamespace(identity=SimpleNamespace(direct_reports={"A", "B"}), hr=lambda: nullcontext(hr))
    result = team_decide_vacation(ctx, DecideArgs(colleague="Camila", decision="approve"))
    assert result.error and "2 pessoas" in result.summary
    assert result.suggestions == ["Aprovar as férias de Camila Martins", "Aprovar as férias de Camila Souza"]
    pending.pop("B")  # only one of them is waiting for a decision: that one, no question asked
    assert [p.name for p in _decide_candidates(ctx, "Camila")[0]] == ["Camila Martins"]


@pytest.mark.parametrize("persona,q", [("colaborador", "Qual a política para levar meu cachorro ao escritório às sextas?"),
                                       ("gestora", "aprova as férias do Zacarias")])
def test_every_not_found_offers_two_questions_and_the_hr_ticket(chat, persona, q):
    turn = chat(persona, q)
    chips = _suggestions(turn)
    assert "Não encontrei" in turn.text, turn.text
    assert len(chips) == 3 and chips[-1] == "Abrir um chamado para o RH", chips


def test_own_data_question_with_a_possessive_reads_the_personal_tool_first(chat):
    turn = chat("colaborador", "Minhas férias acumuladas expiram em que mês?")
    assert turn.tools and turn.tools[0]["tool"] == "vacation_get_balance"


def test_governance_questions_get_console_data_with_a_link(chat, services, identity):
    from atrium.runtime.registry import execute
    from atrium.runtime.tool import ToolContext

    turn = chat("governanca", "Qual foi o custo do assistente neste mês?")
    assert turn.route["agents"] == ["governance"]
    card = next(c for c in turn.cards if c["type"] == "table")
    assert card["data"]["link"]["href"] == "/console?tab=overview"
    ctx = ToolContext(identity=identity("colaborador"), services=services, agent_id="governance")
    assert execute(ctx, "governance_usage", {}, {"governance_usage"}).status == "denied"



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
