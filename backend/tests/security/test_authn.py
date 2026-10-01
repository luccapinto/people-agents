"""Token verification: development IdP and OIDC (RS256 with a stubbed JWKS)."""

import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from atrium import authn
from atrium.authn import AuthError, check_step_up_code, issue_dev_token, step_up_code, verify_token

SECRET = "test-secret-0123456789abcdef0123456789"


def test_dev_token_round_trip_and_rejections():
    token = issue_dev_token(SECRET, "E1023")
    assert verify_token(token, dev_secret=SECRET, dev_enabled=True).employee_id == "E1023"
    with pytest.raises(AuthError):
        verify_token(token, dev_secret="another-secret-0123456789abcdef0123", dev_enabled=True)
    with pytest.raises(AuthError, match="disabled"):
        verify_token(token, dev_secret=SECRET, dev_enabled=False)
    expired = jwt.encode({"iss": authn.DEV_ISSUER, "aud": authn.AUDIENCE, "sub": "E1023", "exp": int(time.time()) - 10}, SECRET, "HS256")
    with pytest.raises(AuthError):
        verify_token(expired, dev_secret=SECRET, dev_enabled=True)
    forged = jwt.encode({"iss": "https://evil.example", "sub": "E1023"}, "x" * 32, "HS256")
    with pytest.raises(AuthError, match="untrusted"):
        verify_token(forged, dev_secret=SECRET, dev_enabled=True, oidc_issuer="https://idp.example")


def test_oidc_token_maps_email_and_ignores_role_claims(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    issuer = "https://idp.example"
    monkeypatch.setattr(authn, "_jwks_client", lambda iss: SimpleNamespace(
        get_signing_key_from_jwt=lambda tok: SimpleNamespace(key=key.public_key())))
    token = jwt.encode({"iss": issuer, "aud": "atrium-web", "sub": "abc", "email": "rafael.lima@nimbus.example",
                        "email_verified": True, "roles": ["governance_admin"], "exp": int(time.time()) + 60}, key, "RS256")
    claims = verify_token(token, dev_secret=SECRET, dev_enabled=False, oidc_issuer=issuer, oidc_audience="atrium-web")
    assert claims.email == "rafael.lima@nimbus.example" and claims.employee_id is None and claims.subject == "abc"
    unverified = jwt.encode({"iss": issuer, "aud": "atrium-web", "sub": "abc", "email": "rafael.lima@nimbus.example",
                             "exp": int(time.time()) + 60}, key, "RS256")
    claims = verify_token(unverified, dev_secret=SECRET, dev_enabled=False, oidc_issuer=issuer, oidc_audience="atrium-web")
    assert claims.email is None and claims.email_unverified
    assert not hasattr(claims, "roles")  # roles come from the system of record, never from the token
    with pytest.raises(AuthError):
        verify_token(token, dev_secret=SECRET, dev_enabled=False, oidc_issuer=issuer, oidc_audience="other-app")


def test_step_up_codes_are_per_person_and_time_boxed():
    code = step_up_code(SECRET, "E1023")
    assert check_step_up_code(SECRET, "E1023", code)
    assert not check_step_up_code(SECRET, "E1003", code)
    assert not check_step_up_code(SECRET, "E1023", step_up_code(SECRET, "E1023", time.time() - 3600))
