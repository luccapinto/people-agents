"""Identity links: map an OIDC (issuer, subject) pair to an employee.

The stable subject is the primary key of a federated identity; e-mail is only a fallback and
only when the IdP asserts it is verified (see docs/security-model.md, "Authentication").

Revision ID: 0002
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr.identity_links (
            issuer text NOT NULL,
            subject text NOT NULL,
            employee_id text NOT NULL REFERENCES hr.employees(id),
            linked_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (issuer, subject)
        );
        -- Not readable by the runtime role; only the definer helper resolves it.
        REVOKE ALL ON hr.identity_links FROM atrium_app;

        CREATE FUNCTION hr.employee_id_for_subject(p_issuer text, p_subject text) RETURNS text
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
            SELECT l.employee_id FROM hr.identity_links l JOIN hr.employees e ON e.id = l.employee_id
            WHERE l.issuer = p_issuer AND l.subject = p_subject AND e.status = 'active'
        $$;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS hr.employee_id_for_subject(text, text); DROP TABLE IF EXISTS hr.identity_links;")
