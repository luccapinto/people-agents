"""The serving container never holds the owner credentials (ADR 0016).

The owner role owns every table and is not bound by RLS. Only the one-shot ``migrate``
service may receive it; a code-execution bug in the API must not be able to read it from
its own environment.
"""

import json

import yaml

from atrium.config import REPO_ROOT

COMPOSE = yaml.safe_load((REPO_ROOT / "deploy/docker-compose.yml").read_text())
SERVICES = COMPOSE["services"]


def _env(service: str) -> dict:
    env = SERVICES[service].get("environment") or {}
    return env if isinstance(env, dict) else dict(item.split("=", 1) for item in env)


def test_only_the_migrate_service_receives_the_owner_role():
    holders = {name for name in SERVICES if "atrium_owner" in json.dumps(_env(name))}
    assert holders == {"migrate"}
    assert "ATRIUM_OWNER_DATABASE_URL" not in _env("api")
    assert "atrium_app:" in _env("api")["ATRIUM_DATABASE_URL"]


def test_api_starts_only_after_migrations_and_does_not_seed_itself():
    assert SERVICES["api"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    cmd = next(line for line in (REPO_ROOT / "deploy/api.Dockerfile").read_text().splitlines() if line.startswith("CMD"))
    assert "serve" in cmd and "seed" not in cmd
    assert "seed" in SERVICES["migrate"]["command"]
