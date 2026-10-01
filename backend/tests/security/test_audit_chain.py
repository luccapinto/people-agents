"""The audit hash chain detects tampering with a single event."""

import pytest
from sqlalchemy import text

from atrium.runtime.audit import AuditLog, verify_chain
from tests.conftest import PERSONA

pytestmark = [pytest.mark.db, pytest.mark.security]


def test_chain_verifies_and_detects_a_tampered_event(db, owner_engine):
    log = AuditLog(db)
    ids = [log.append("tool.call", actor=PERSONA["colaborador"], subject=PERSONA["colaborador"],
                      payload={"tool": "vacation_get_balance", "n": i, "cpf": "529.982.247-25"}) for i in range(3)]
    with owner_engine.begin() as c:
        assert verify_chain(c).ok
        stored = c.execute(text("SELECT payload FROM app.audit_events WHERE id = :i"), {"i": ids[0]}).scalar_one()
    assert stored["cpf"] == "[CPF]", "PII must be masked before it reaches the audit log"

    with owner_engine.begin() as c:
        # An insider with owner rights disables the trigger and edits one event.
        c.execute(text("ALTER TABLE app.audit_events DISABLE TRIGGER audit_no_update"))
        c.execute(text("UPDATE app.audit_events SET payload = jsonb_set(payload, '{n}', '99') WHERE id = :i"), {"i": ids[1]})
        c.execute(text("ALTER TABLE app.audit_events ENABLE TRIGGER audit_no_update"))
    with owner_engine.begin() as c:
        result = verify_chain(c)
    assert not result.ok
    assert result.broken_at == ids[1]

    with owner_engine.begin() as c:  # restore for the rest of the suite
        c.execute(text("ALTER TABLE app.audit_events DISABLE TRIGGER audit_no_update"))
        c.execute(text("UPDATE app.audit_events SET payload = jsonb_set(payload, '{n}', '1') WHERE id = :i"), {"i": ids[1]})
        c.execute(text("ALTER TABLE app.audit_events ENABLE TRIGGER audit_no_update"))
        assert verify_chain(c).ok


def test_trigger_blocks_updates_even_for_the_owner(owner_engine, db):
    AuditLog(db).append("test.event")
    with pytest.raises(Exception, match="append-only"), owner_engine.begin() as c:
        c.execute(text("UPDATE app.audit_events SET type = 'x'"))
