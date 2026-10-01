"""Database access. Every request-scoped transaction carries the caller's identity.

``Database.scoped(employee_id)`` opens a transaction and runs
``set_config('app.employee_id', <id>, true)`` (transaction-local), which is the only
identity input the row-level security policies use.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine


class Database:
    def __init__(self, url: str, pool_size: int = 10) -> None:
        self.url = url
        self.engine: Engine = create_engine(url, pool_pre_ping=True, pool_size=pool_size, max_overflow=10)

    @contextmanager
    def scoped(self, employee_id: str | None) -> Iterator[Connection]:
        with self.engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.employee_id', :e, true)"), {"e": employee_id or ""})
            yield conn

    @contextmanager
    def anonymous(self) -> Iterator[Connection]:
        """No identity: only SECURITY DEFINER helpers (identity resolution, audit append) succeed."""
        with self.engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.employee_id', '', true)"))
            yield conn

    def dispose(self) -> None:
        self.engine.dispose()
