"""Authentication: a development identity provider and OIDC-ready token verification.

- Development (``ATRIUM_DEV_IDP=true``): ``/api/auth/login`` issues an HS256 JWT for one of
  the fictional personas. Step-up uses a time-boxed one-time code "delivered" by the dev IdP.
- Production: set ``ATRIUM_OIDC_ISSUER`` (and audience). Tokens are verified against the
  issuer's JWKS; the ``email`` claim is mapped to an employee through the directory.
  Step-up maps to a fresh ``auth_time`` (re-authentication with ``max_age``).

Roles are never read from the token: they come from the system of record.
"""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt

DEV_ISSUER = "atrium-dev-idp"
AUDIENCE = "atrium"
TOKEN_TTL_S = 8 * 3600
STEP_UP_WINDOW_S = 300


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    employee_id: str | None
    email: str | None
    session_id: str
    issuer: str


def issue_dev_token(secret: str, employee_id: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": DEV_ISSUER, "aud": AUDIENCE, "sub": employee_id, "sid": uuid.uuid4().hex, "iat": now, "exp": now + TOKEN_TTL_S},
        secret,
        algorithm="HS256",
    )


@lru_cache(maxsize=4)
def _jwks_client(issuer: str) -> jwt.PyJWKClient:
    conf = httpx.get(f"{issuer.rstrip('/')}/.well-known/openid-configuration", timeout=10).json()
    return jwt.PyJWKClient(conf["jwks_uri"])


def verify_token(token: str, *, dev_secret: str, dev_enabled: bool, oidc_issuer: str = "", oidc_audience: str = "") -> TokenClaims:
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        raise AuthError("malformed token") from exc
    issuer = unverified.get("iss", "")
    try:
        if issuer == DEV_ISSUER:
            if not dev_enabled:
                raise AuthError("development identity provider is disabled")
            claims = jwt.decode(token, dev_secret, algorithms=["HS256"], audience=AUDIENCE, issuer=DEV_ISSUER)
            return TokenClaims(employee_id=claims["sub"], email=None, session_id=claims.get("sid", ""), issuer=issuer)
        if oidc_issuer and issuer == oidc_issuer:
            key = _jwks_client(oidc_issuer).get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience=oidc_audience or None, issuer=oidc_issuer)
            return TokenClaims(employee_id=None, email=claims.get("email"), session_id=claims.get("sid", ""), issuer=issuer)
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc
    raise AuthError("untrusted issuer")


def step_up_code(secret: str, employee_id: str, at: float | None = None) -> str:
    """Six-digit one-time code valid for the current 5-minute window (dev IdP only)."""
    window = int((at or time.time()) // STEP_UP_WINDOW_S)
    mac = hmac.new(secret.encode(), f"step-up:{employee_id}:{window}".encode(), hashlib.sha256).hexdigest()
    return f"{int(mac[:8], 16) % 1_000_000:06d}"


def check_step_up_code(secret: str, employee_id: str, code: str) -> bool:
    now = time.time()
    return any(hmac.compare_digest(step_up_code(secret, employee_id, now - d), code.strip()) for d in (0, STEP_UP_WINDOW_S))
