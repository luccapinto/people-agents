"""Policy engine decisions for the manager, HRBP and self-service scenarios."""

import pytest

from atrium.authz.identity import load_identity
from atrium.authz.policy import PolicyEngine, PolicyStore
from tests.conftest import BY_NAME, DATASET, PERSONA

pytestmark = [pytest.mark.db, pytest.mark.security]


@pytest.fixture(scope="module")
def engine(db):
    return PolicyEngine(PolicyStore(db, ttl_s=0))


@pytest.fixture(scope="module")
def who(db):
    return lambda key: load_identity(db, PERSONA[key])


def test_identity_comes_from_the_system_of_record(who):
    m = who("gestora")
    assert m.is_manager and "manager" in m.roles
    assert PERSONA["colaborador"] in m.direct_reports
    assert who("hrbp").is_hrbp and who("governanca").is_governance
    assert not who("colaborador").is_manager


def test_self_service_cannot_target_someone_else(engine, who):
    me = who("colaborador")
    assert engine.authorize(me, "self.vacation.read", me.employee_id).allowed
    assert not engine.authorize(me, "self.vacation.read", BY_NAME["Maria Oliveira"]).allowed


def test_manager_reads_direct_report_vacation(engine, who):
    d = engine.authorize(who("gestora"), "team.vacation.read", PERSONA["colaborador"])
    assert d.allowed and d.policy == "manager_chain"


def test_manager_denied_direct_report_salary_by_default(engine, who):
    d = engine.authorize(who("gestora"), "team.compensation.read", PERSONA["colaborador"])
    assert not d.allowed and d.policy == "manager_can_view_team_compensation"


def test_manager_salary_switch(engine, who, set_policy):
    set_policy("manager_can_view_team_compensation", {"enabled": True})
    engine.store.invalidate()
    assert engine.authorize(who("gestora"), "team.compensation.read", PERSONA["colaborador"]).allowed


def test_manager_denied_outside_chain(engine, who):
    d = engine.authorize(who("gestora"), "team.vacation.read", BY_NAME["Maria Oliveira"])
    assert not d.allowed and d.policy == "manager_chain"


def test_non_manager_asking_about_a_colleague_is_a_personal_data_denial(engine, who):
    # The audit trail must say why: not "outside the leadership chain" for someone who leads nobody.
    for action in ("team.vacation.read", "team.compensation.read"):
        d = engine.authorize(who("colaborador"), action, PERSONA["gestora"])
        assert not d.allowed and d.policy == "personal_data_owner"
    d = engine.authorize(who("gestora"), "other.personal.read", PERSONA["colaborador"])
    assert not d.allowed and d.policy == "personal_data_owner"
    assert engine.authorize(who("colaborador"), "team.vacation.decide", PERSONA["gestora"]).policy == "direct_report"


def test_only_the_direct_manager_decides(engine, who):
    assert engine.authorize(who("gestora"), "team.vacation.decide", PERSONA["colaborador"]).allowed
    assert not engine.authorize(who("gestora"), "team.vacation.decide", BY_NAME["Maria Oliveira"]).allowed


def test_hrbp_scope(engine, who):
    units = DATASET["units"]
    hrbp = who("hrbp")
    assert engine.authorize(hrbp, "analytics.aggregate", unit_ids=["U11", "U12"], all_units=units).allowed
    assert not engine.authorize(hrbp, "analytics.aggregate", unit_ids=["U31"], all_units=units).allowed
    assert not engine.authorize(who("gestora"), "analytics.aggregate", unit_ids=["U11"], all_units=units).allowed


def test_k_anonymity_cannot_be_configured_below_five(engine, set_policy):
    set_policy("k_anonymity_min", {"value": 2})
    engine.store.invalidate()
    assert engine.k_anonymity() == 5


def test_default_deny(engine, who):
    assert not engine.authorize(who("governanca"), "payroll.export_all").allowed
