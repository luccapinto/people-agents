"""FastAPI dependencies: the services singleton and the authenticated identity."""

from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, Header, HTTPException

from atrium.authn import AuthError, verify_token
from atrium.authz.identity import IdentityContext, employee_id_for_email, load_identity
from atrium.services import Services, build_services

_override: Services | None = None


def set_services(services: Services | None) -> None:
    """Tests inject their own services (fake model, test database)."""
    global _override
    _override = services
    _default.cache_clear()


@lru_cache(maxsize=1)
def _default() -> Services:
    return build_services()


def get_services() -> Services:
    return _override or _default()


def current_identity(authorization: str = Header(default=""), services: Services = Depends(get_services)) -> IdentityContext:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    s = services.settings
    try:
        claims = verify_token(authorization[7:], dev_secret=s.dev_jwt_secret, dev_enabled=s.dev_idp_enabled,
                              oidc_issuer=s.oidc_issuer, oidc_audience=s.oidc_audience)
    except AuthError as exc:
        raise HTTPException(401, f"invalid token: {exc}") from exc
    employee_id = claims.employee_id or (employee_id_for_email(services.db, claims.email) if claims.email else None)
    identity = load_identity(services.db, employee_id, claims.session_id) if employee_id else None
    if identity is None:
        raise HTTPException(403, "no active employee for this identity")
    return identity


def require_governance(identity: IdentityContext = Depends(current_identity)) -> IdentityContext:
    if not identity.is_governance:
        raise HTTPException(403, "governance role required")
    return identity
