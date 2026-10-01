"""The reference adapter returns the fictional company's data for the bound identity."""

import json

import pytest

from atrium.config import REPO_ROOT
from tests.conftest import BY_NAME, DATASET, PERSONA

pytestmark = pytest.mark.db


def test_dataset_is_committed_and_up_to_date():
    from atrium.exports import build_dataset

    committed = json.loads((REPO_ROOT / "shared/generated/dataset.json").read_text())
    assert committed == json.loads(json.dumps(build_dataset(), ensure_ascii=False)), "run `uv run atrium generate`"


def test_dataset_has_required_personas_and_scale():
    active = [e for e in DATASET["employees"] if e["status"] == "active"]
    assert 100 <= len(active) <= 140
    manager = PERSONA["gestora"]
    team = [e for e in active if e["manager_id"] == manager]
    assert 6 <= len(team) <= 10
    assert "Maria Oliveira" in BY_NAME


def test_employee_reads_own_vacation_and_payslips(gateway):
    me = PERSONA["colaborador"]
    with gateway.session(me) as hr:
        periods = hr.vacation.periods(me)
        payslips = hr.payroll.payslips(me, 2026)
        assert any(p.status == "open" for p in periods)
        assert [p.month for p in payslips if p.kind == "monthly"][-1] == "2026-09"
        assert hr.payroll.payslip(me, "2026-09").net > 0
        assert hr.benefits.enrollments(me)
        assert hr.profile.bank_account(me) is not None


def test_directory_search_is_accent_insensitive(gateway):
    with gateway.session(PERSONA["colaborador"]) as hr:
        names = [e.name for e in hr.directory.search("patricia")]
        assert "Patrícia Almeida" in names


def test_rows_of_other_people_simply_do_not_exist_for_the_session(gateway):
    me = PERSONA["colaborador"]
    maria = BY_NAME["Maria Oliveira"]
    with gateway.session(me) as hr:
        assert hr.payroll.payslips(maria) == []
        assert hr.payroll.salary_history(maria) == []
        assert hr.vacation.periods(maria) == []
        assert hr.profile.bank_account(maria) is None
        assert hr.directory.get(maria) is not None  # directory entry is public inside the company


def test_manager_session_sees_team_vacation(gateway):
    manager = PERSONA["gestora"]
    with gateway.session(manager) as hr:
        team = hr.directory.reports(manager)
        requests = hr.vacation.requests_for([e.id for e in team])
        assert {r.employee_id for r in requests} & {e.id for e in team}
        assert any(r.status == "pending_manager" for r in requests)
