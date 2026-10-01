"""OIDC identity resolution: stable subject first, verified e-mail only as a fallback.

A token whose e-mail is not asserted as verified must never become that person's identity
(the "nOAuth" class: multi-tenant or self-service IdPs let users set any e-mail)."""

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import text

from atrium import authn
from atrium.api.app import create_app
from atrium.api.deps import set_services
from atrium.config import Settings
from atrium.runtime.llm.fake import FakeProvider
from atrium.services import Services
from tests.conftest import APP_URL, BY_NAME, PERSONA

pytestmark = [pytest.mark.db, pytest.mark.security]

ISSUER = "https://idp.nimbus.example"
AUDIENCE = "atrium-web"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
MARIA_EMAIL = "maria.oliveira@nimbus.example"


@pytest.fixture(scope="module")
def client(services, monkeypatch_module):
    monkeypatch_module.setattr(authn, "_jwks_client", lambda iss: SimpleNamespace(
        get_signing_key_from_jwt=lambda tok: SimpleNamespace(key=KEY.public_key())))
    settings = Settings(ATRIUM_DATABASE_URL=APP_URL, ATRIUM_OIDC_ISSUER=ISSUER, ATRIUM_OIDC_AUDIENCE=AUDIENCE,
                        ATRIUM_DEV_IDP=False, ATRIUM_EMBEDDINGS="hash")
    set_services(Services(settings=settings, db=services.db, llm=FakeProvider()))
    yield TestClient(create_app())
    set_services(None)


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def token(**claims) -> dict:
    body = {"iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300, **claims}
    return {"Authorization": f"Bearer {jwt.encode(body, KEY, 'RS256')}"}


def test_unverified_email_is_rejected(client):
    r = client.get("/api/me", headers=token(sub="attacker-123", email=MARIA_EMAIL, email_verified=False))
    assert r.status_code == 401
    r = client.get("/api/me", headers=token(sub="attacker-123", email=MARIA_EMAIL))  # claim absent = not verified
    assert r.status_code == 401


def test_verified_email_is_accepted_as_fallback(client):
    r = client.get("/api/me", headers=token(sub="maria-sub", email=MARIA_EMAIL, email_verified=True))
    assert r.status_code == 200 and r.json()["employee_id"] == BY_NAME["Maria Oliveira"]


def test_linked_subject_wins_over_any_email_claim(client, owner_engine):
    with owner_engine.begin() as c:
        c.execute(text("INSERT INTO hr.identity_links (issuer, subject, employee_id) VALUES (:i, 'rafael-sub', :e) ON CONFLICT DO NOTHING"),
                  {"i": ISSUER, "e": PERSONA["colaborador"]})
    r = client.get("/api/me", headers=token(sub="rafael-sub", email=MARIA_EMAIL, email_verified=True))
    assert r.status_code == 200 and r.json()["employee_id"] == PERSONA["colaborador"]


def test_dev_idp_tokens_are_refused_when_dev_idp_is_disabled(client):
    dev = authn.issue_dev_token("change-me-dev-only", PERSONA["governanca"])
    assert client.get("/api/me", headers={"Authorization": f"Bearer {dev}"}).status_code == 401


def test_identity_links_are_not_readable_by_the_runtime_role(db):
    with pytest.raises(Exception, match="permission denied"), db.scoped(PERSONA["colaborador"]) as c:
        c.execute(text("SELECT * FROM hr.identity_links"))
