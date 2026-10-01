"""Schema management. Alembic owns the version table; the DDL lives in plain SQL files
under ``atrium/db/sql`` so readers can review the security model as SQL."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

SQL_DIR = Path(__file__).parent / "sql"
ALEMBIC_DIR = Path(__file__).parent / "alembic"


def alembic_config(owner_url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", owner_url.replace("%", "%%"))
    return cfg


def upgrade(owner_url: str) -> None:
    command.upgrade(alembic_config(owner_url), "head")


def reset(owner_url: str) -> None:
    """Drop the platform schemas (owned by atrium_owner) and re-run migrations."""
    engine = create_engine(owner_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS app CASCADE"))
        conn.execute(text("DROP SCHEMA IF EXISTS hr CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS public.alembic_version"))
    engine.dispose()
    upgrade(owner_url)


def run_sql_file(conn, name: str) -> None:
    # Raw DBAPI cursor without parameters: psycopg sends multi-statement scripts verbatim
    # (no placeholder parsing, so format('%I') inside DO blocks is safe).
    with conn.connection.dbapi_connection.cursor() as cur:
        cur.execute((SQL_DIR / name).read_text())
