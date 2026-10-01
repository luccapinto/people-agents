"""Guard updates of requests at the database layer.

RLS lets the requester and any manager in the chain UPDATE a vacation request, leave or
time adjustment (cancel, decide). RLS cannot express *which* columns or values each may
change, so without this trigger a bug in application code could let an employee approve
their own request. Rules for the runtime role (an identity is always set):
- nobody may move a request to another employee or edit anything but status and decision;
- the requester may only cancel it (status → cancelled) and cannot record a decision;
- anyone else must be the requester's direct manager (the policy engine's ``direct_report``
  rule for ``team.vacation.decide``): a skip-level manager is refused here even though RLS
  shows them the row.

Revision ID: 0003
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

TABLES = ("vacation_requests", "leave_requests", "time_adjustments")


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION hr.guard_request_update() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, hr AS $$
        DECLARE
            me text := hr.current_employee();
            decision_cols text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note'];
            old_rest jsonb := to_jsonb(OLD) - decision_cols;
            new_rest jsonb := to_jsonb(NEW) - decision_cols;
        BEGIN
            IF me IS NULL THEN
                RETURN NEW;  -- maintenance by the owner role (migrations, seed); no identity set
            END IF;
            IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
                RAISE EXCEPTION 'a request cannot be moved to another employee' USING ERRCODE = '42501';
            END IF;
            IF new_rest IS DISTINCT FROM old_rest THEN
                RAISE EXCEPTION 'only the status and decision fields of a request can change' USING ERRCODE = '42501';
            END IF;
            IF me = OLD.employee_id THEN
                IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
                    RAISE EXCEPTION 'the requester may only cancel their own request' USING ERRCODE = '42501';
                END IF;
                IF (to_jsonb(NEW) ->> 'decided_by') IS DISTINCT FROM (to_jsonb(OLD) ->> 'decided_by') THEN
                    RAISE EXCEPTION 'the requester cannot record a decision' USING ERRCODE = '42501';
                END IF;
            ELSIF NOT EXISTS (SELECT 1 FROM hr.employees WHERE id = OLD.employee_id AND manager_id = me) THEN
                RAISE EXCEPTION 'only the requester or their direct manager can update a request' USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END $$;
    """)
    for table in TABLES:
        op.execute(f"CREATE TRIGGER guard_update BEFORE UPDATE ON hr.{table} FOR EACH ROW EXECUTE FUNCTION hr.guard_request_update()")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS guard_update ON hr.{table}")
    op.execute("DROP FUNCTION IF EXISTS hr.guard_request_update()")
