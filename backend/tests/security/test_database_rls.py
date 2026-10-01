"""Defense in depth: the database itself refuses rows, even if application code forgets a filter.

These tests bypass the application entirely: raw SQL as the runtime role ``atrium_app``
with the transaction-local identity set, exactly as the API does.
"""

import pytest
from sqlalchemy import text

from tests.conftest import BY_NAME, DATASET, PERSONA

pytestmark = [pytest.mark.db, pytest.mark.security]

SELF_ONLY_TABLES = [
    "employee_private", "dependents", "benefit_enrollments", "benefit_balances", "bank_accounts", "addresses",
    "reimbursements", "employee_skills",
]
COMPENSATION_TABLES = ["compensation", "payslips", "income_statements", "plr"]
TEAM_TABLES = ["vacation_periods", "vacation_requests", "time_bank", "absences", "training_assignments"]
DATASET_EMPLOYEES = {e["id"]: e for e in DATASET["employees"]}


def count(db, identity, sql, **params):
    with db.scoped(identity) as c:
        return c.execute(text(sql), params).scalar_one()


@pytest.mark.parametrize("table", SELF_ONLY_TABLES + COMPENSATION_TABLES + TEAM_TABLES)
def test_employee_a_cannot_read_rows_of_b_with_direct_sql(db, table):
    a = PERSONA["colaborador"]
    b = BY_NAME["Maria Oliveira"]
    assert count(db, a, f"SELECT count(*) FROM hr.{table} WHERE employee_id = :b", b=b) == 0
    # ... and not by omitting the filter either: everything visible belongs to A.
    assert count(db, a, f"SELECT count(*) FROM hr.{table} WHERE employee_id <> :a", a=a) == 0


@pytest.mark.parametrize("table", SELF_ONLY_TABLES + COMPENSATION_TABLES + TEAM_TABLES)
def test_no_identity_sees_nothing(db, table):
    assert count(db, None, f"SELECT count(*) FROM hr.{table}") == 0


def test_b_really_has_rows_so_the_tests_above_are_meaningful(owner_engine):
    b = BY_NAME["Maria Oliveira"]
    with owner_engine.begin() as c:
        for table in SELF_ONLY_TABLES[:6] + COMPENSATION_TABLES[:2] + TEAM_TABLES[:2]:
            assert c.execute(text(f"SELECT count(*) FROM hr.{table} WHERE employee_id = :b"), {"b": b}).scalar_one() > 0, table


def test_manager_sees_team_vacation_but_not_team_compensation(db):
    m = PERSONA["gestora"]
    report = PERSONA["colaborador"]
    assert count(db, m, "SELECT count(*) FROM hr.vacation_requests WHERE employee_id = :r", r=report) > 0
    assert count(db, m, "SELECT count(*) FROM hr.payslips WHERE employee_id = :r", r=report) == 0
    assert count(db, m, "SELECT count(*) FROM hr.compensation WHERE employee_id = :r", r=report) == 0


def test_compensation_switch_is_enforced_by_the_database_too(db, set_policy):
    m = PERSONA["gestora"]
    report = PERSONA["colaborador"]
    set_policy("manager_can_view_team_compensation", {"enabled": True})
    assert count(db, m, "SELECT count(*) FROM hr.payslips WHERE employee_id = :r", r=report) > 0
    # Still nothing outside the chain.
    assert count(db, m, "SELECT count(*) FROM hr.payslips WHERE employee_id = :b", b=BY_NAME["Maria Oliveira"]) == 0


def test_manager_cannot_read_vacation_outside_chain(db):
    m = PERSONA["gestora"]
    assert count(db, m, "SELECT count(*) FROM hr.vacation_requests WHERE employee_id = :b", b=BY_NAME["Maria Oliveira"]) == 0


def test_hrbp_sees_covered_unit_vacation_but_never_compensation(db):
    hrbp = PERSONA["hrbp"]
    tech_person = PERSONA["colaborador"]
    finance_person = BY_NAME["Maria Oliveira"]
    assert count(db, hrbp, "SELECT count(*) FROM hr.vacation_periods WHERE employee_id = :e", e=tech_person) > 0
    assert count(db, hrbp, "SELECT count(*) FROM hr.vacation_periods WHERE employee_id = :e", e=finance_person) == 0
    assert count(db, hrbp, "SELECT count(*) FROM hr.compensation WHERE employee_id = :e", e=tech_person) == 0


def test_employee_cannot_insert_a_vacation_request_for_someone_else(db):
    a = PERSONA["colaborador"]
    b = BY_NAME["Maria Oliveira"]
    with pytest.raises(Exception, match="row-level security"), db.scoped(a) as c:
        c.execute(text(
            """INSERT INTO hr.vacation_requests (id, employee_id, period_id, start, days, status, requested_at)
               SELECT 'FER-HACK', :b, id, '2026-12-01', 10, 'approved', '2026-10-01' FROM hr.vacation_periods LIMIT 1"""), {"b": b})


def test_employee_cannot_update_someone_elses_bank_account(db):
    a = PERSONA["colaborador"]
    b = BY_NAME["Maria Oliveira"]
    with db.scoped(a) as c:
        res = c.execute(text("UPDATE hr.bank_accounts SET account = '00000-0' WHERE employee_id = :b"), {"b": b})
        assert res.rowcount == 0


def _status(owner_engine, rid: str) -> str:
    with owner_engine.begin() as c:
        return c.execute(text("SELECT status FROM hr.vacation_requests WHERE id = :id"), {"id": rid}).scalar_one()


def test_requester_cannot_approve_own_request_even_with_raw_sql(db, owner_engine, pending_request):
    me = PERSONA["colaborador"]
    rid = pending_request(me)
    with pytest.raises(Exception, match="may only cancel"), db.scoped(me) as c:
        c.execute(text("UPDATE hr.vacation_requests SET status = 'approved' WHERE id = :id"), {"id": rid})
    with pytest.raises(Exception, match="cannot record a decision"), db.scoped(me) as c:
        c.execute(text("UPDATE hr.vacation_requests SET decided_by = :m WHERE id = :id"), {"m": PERSONA["gestora"], "id": rid})
    with pytest.raises(Exception, match="status and decision fields"), db.scoped(me) as c:
        c.execute(text("UPDATE hr.vacation_requests SET days = 30 WHERE id = :id"), {"id": rid})
    with pytest.raises(Exception, match="another employee"), db.scoped(me) as c:
        c.execute(text("UPDATE hr.vacation_requests SET employee_id = :b WHERE id = :id"), {"b": BY_NAME["Maria Oliveira"], "id": rid})
    assert _status(owner_engine, rid) == "pending_manager"
    with db.scoped(me) as c:  # cancelling is allowed
        assert c.execute(text("UPDATE hr.vacation_requests SET status = 'cancelled' WHERE id = :id"), {"id": rid}).rowcount == 1
    assert _status(owner_engine, rid) == "cancelled"


def test_direct_manager_decides_but_cannot_rewrite_the_request(db, owner_engine, pending_request):
    rid = pending_request(PERSONA["colaborador"])
    with pytest.raises(Exception, match="status and decision fields"), db.scoped(PERSONA["gestora"]) as c:
        c.execute(text("UPDATE hr.vacation_requests SET start = '2027-01-04' WHERE id = :id"), {"id": rid})
    with db.scoped(PERSONA["gestora"]) as c:
        n = c.execute(text("UPDATE hr.vacation_requests SET status = 'approved', decided_by = :m WHERE id = :id"),
                      {"m": PERSONA["gestora"], "id": rid}).rowcount
        assert n == 1
    assert _status(owner_engine, rid) == "approved"


def test_manager_outside_the_chain_cannot_decide_with_raw_sql(db, owner_engine, pending_request):
    rid = pending_request(BY_NAME["Maria Oliveira"])  # not in Mariana Costa's chain
    with db.scoped(PERSONA["gestora"]) as c:
        res = c.execute(text("UPDATE hr.vacation_requests SET status = 'approved', decided_by = :m WHERE id = :id"),
                        {"m": PERSONA["gestora"], "id": rid})
        assert res.rowcount == 0  # RLS: the row does not exist for her
    assert _status(owner_engine, rid) == "pending_manager"


def test_skip_level_manager_cannot_decide_with_raw_sql(db, owner_engine, pending_request):
    # RLS shows the whole chain the row; deciding is for the direct manager only.
    skip_level = DATASET_EMPLOYEES[DATASET_EMPLOYEES[PERSONA["colaborador"]]["manager_id"]]["manager_id"]
    rid = pending_request(PERSONA["colaborador"])
    with db.scoped(skip_level) as c:
        assert c.execute(text("SELECT count(*) FROM hr.vacation_requests WHERE id = :id"), {"id": rid}).scalar_one() == 1
    with pytest.raises(Exception, match="direct manager"), db.scoped(skip_level) as c:
        c.execute(text("UPDATE hr.vacation_requests SET status = 'approved', decided_by = :m WHERE id = :id"),
                  {"m": skip_level, "id": rid})
    assert _status(owner_engine, rid) == "pending_manager"


def test_platform_role_tables_are_not_readable_by_the_runtime_role(db):
    with pytest.raises(Exception, match="permission denied"), db.scoped(PERSONA["colaborador"]) as c:
        c.execute(text("SELECT * FROM hr.platform_roles"))


def test_conversations_are_private_to_their_owner(db):
    a, b = PERSONA["colaborador"], PERSONA["gestora"]
    with db.scoped(a) as c:
        conv = c.execute(text("INSERT INTO app.conversations (owner_id, title) VALUES (:a, 'privada') RETURNING id"), {"a": a}).scalar_one()
        c.execute(text("INSERT INTO app.messages (conversation_id, owner_id, role, content) VALUES (:c, :a, 'user', 'segredo')"), {"c": conv, "a": a})
    assert count(db, b, "SELECT count(*) FROM app.messages WHERE conversation_id = :c", c=conv) == 0
    assert count(db, PERSONA["governanca"], "SELECT count(*) FROM app.messages WHERE conversation_id = :c", c=conv) == 0
    assert count(db, a, "SELECT count(*) FROM app.messages WHERE conversation_id = :c", c=conv) == 1


def test_governance_reads_a_transcript_only_with_a_justified_grant(db):
    a, gov = PERSONA["colaborador"], PERSONA["governanca"]
    with db.scoped(a) as c:
        conv = c.execute(text("INSERT INTO app.conversations (owner_id) VALUES (:a) RETURNING id"), {"a": a}).scalar_one()
        c.execute(text("INSERT INTO app.messages (conversation_id, owner_id, role, content) VALUES (:c, :a, 'user', 'oi')"), {"c": conv, "a": a})
    # A manager cannot self-grant.
    with pytest.raises(Exception, match="row-level security"), db.scoped(PERSONA["gestora"]) as c:
        c.execute(text("""INSERT INTO app.transcript_grants (conversation_id, grantee_id, justification, expires_at)
                          VALUES (:c, :g, 'investigação de incidente de segurança #42', now() + interval '1 hour')"""),
                  {"c": conv, "g": PERSONA["gestora"]})
    with db.scoped(gov) as c:
        c.execute(text("""INSERT INTO app.transcript_grants (conversation_id, grantee_id, justification, expires_at)
                          VALUES (:c, :g, 'investigação de incidente de segurança #42', now() + interval '1 hour')"""),
                  {"c": conv, "g": gov})
    assert count(db, gov, "SELECT count(*) FROM app.messages WHERE conversation_id = :c", c=conv) == 1


def test_audit_events_are_append_only_for_the_runtime_role(db):
    from atrium.runtime.audit import AuditLog

    AuditLog(db).append("test.event", actor=PERSONA["colaborador"], payload={"x": 1})
    with pytest.raises(Exception, match="permission denied"), db.scoped(PERSONA["governanca"]) as c:
        c.execute(text("UPDATE app.audit_events SET payload = '{}'"))
    with pytest.raises(Exception, match="permission denied"), db.scoped(PERSONA["governanca"]) as c:
        c.execute(text("DELETE FROM app.audit_events"))
    with pytest.raises(Exception, match="permission denied"), db.scoped(PERSONA["colaborador"]) as c:
        c.execute(text("INSERT INTO app.audit_events (type, prev_hash, hash) VALUES ('forged', 'x', 'y')"))
    assert count(db, PERSONA["colaborador"], "SELECT count(*) FROM app.audit_events") == 0
