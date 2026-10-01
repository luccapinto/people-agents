"""Shared fixtures. Database tests run against ``atrium_test`` (reset and seeded once per session)."""

from __future__ import annotations

import os

os.environ.setdefault("ATRIUM_TODAY", "2026-10-01")
os.environ.setdefault("ATRIUM_EMBEDDINGS", "hash")
os.environ.setdefault("ATRIUM_LLM_PROVIDER", "fake")

import json  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from atrium.config import REPO_ROOT  # noqa: E402

OWNER_URL = os.environ.get(
    "ATRIUM_TEST_OWNER_URL", "postgresql+psycopg://atrium_owner:atrium_owner@localhost:55432/atrium_test"
)
APP_URL = os.environ.get("ATRIUM_TEST_APP_URL", "postgresql+psycopg://atrium_app:atrium_app@localhost:55432/atrium_test")

DATASET = json.loads((REPO_ROOT / "shared/generated/dataset.json").read_text())
PERSONA = {p["key"]: p["employee_id"] for p in DATASET["personas"]}
BY_NAME = {e["name"]: e["id"] for e in DATASET["employees"]}


@pytest.fixture(scope="session")
def seeded():
    from atrium.bootstrap import bootstrap

    bootstrap(OWNER_URL, APP_URL, reset_schema=True)
    return True


@pytest.fixture(scope="session")
def db(seeded):
    from atrium.db.engine import Database

    database = Database(APP_URL)
    yield database
    database.dispose()


@pytest.fixture(scope="session")
def gateway(db):
    from atrium.adapters.reference.sql import SqlHRGateway

    return SqlHRGateway(db)


@pytest.fixture(scope="session")
def owner_engine(seeded):
    engine = create_engine(OWNER_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def set_policy(owner_engine):
    """Temporarily change a governance policy; restores the previous value afterwards."""
    changed = []

    def _set(key: str, value: dict):
        with owner_engine.begin() as c:
            old = c.execute(text("SELECT value FROM app.policies WHERE key = :k"), {"k": key}).scalar_one()
            changed.append((key, old))
            c.execute(text("UPDATE app.policies SET value = CAST(:v AS jsonb) WHERE key = :k"), {"k": key, "v": json.dumps(value)})

    yield _set
    with owner_engine.begin() as c:
        for key, old in reversed(changed):
            c.execute(text("UPDATE app.policies SET value = CAST(:v AS jsonb) WHERE key = :k"), {"k": key, "v": json.dumps(old)})


pytest_plugins = ["tests.chat_fixtures"]
