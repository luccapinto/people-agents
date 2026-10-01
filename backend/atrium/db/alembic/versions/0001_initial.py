"""Initial schema: hr systems of record, app platform tables, RLS and audit chain.

Revision ID: 0001
"""

from alembic import op

from atrium.db.migrate import run_sql_file

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for name in ("001_hr_schema.sql", "002_app_schema.sql", "003_security.sql"):
        run_sql_file(conn, name)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS app CASCADE")
    op.execute("DROP SCHEMA IF EXISTS hr CASCADE")
