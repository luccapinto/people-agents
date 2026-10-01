"""The authenticated identity, resolved from the system of record (never from the prompt)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import date

from sqlalchemy import text

from atrium.db.engine import Database


@dataclass(frozen=True)
class IdentityContext:
    employee_id: str
    name: str
    email: str
    title: str
    unit_id: str
    unit_path: tuple[str, ...]
    manager_id: str | None
    location: str
    hire_date: date
    direct_reports: frozenset[str] = frozenset()
    chain_reports: frozenset[str] = frozenset()
    hrbp_units: frozenset[str] = frozenset()
    platform_roles: frozenset[str] = frozenset()
    session_id: str = ""
    request_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    @property
    def roles(self) -> frozenset[str]:
        roles = {"employee", *self.platform_roles}
        if self.direct_reports:
            roles.add("manager")
        if self.hrbp_units:
            roles.add("hrbp")
        return frozenset(roles)

    @property
    def is_manager(self) -> bool:
        return bool(self.direct_reports)

    @property
    def is_hrbp(self) -> bool:
        return bool(self.hrbp_units)

    @property
    def is_governance(self) -> bool:
        return "governance_admin" in self.platform_roles

    @property
    def first_name(self) -> str:
        return self.name.split()[0]

    def for_request(self) -> IdentityContext:
        return replace(self, request_id=uuid.uuid4().hex)

    def summary(self) -> dict:
        """What the model is told about the user (no personal data beyond the directory)."""
        return {
            "nome": self.name,
            "cargo": self.title,
            "unidade": self.unit_id,
            "papéis": sorted(self.roles),
            "admissão": self.hire_date.isoformat(),
            "local": self.location,
            "liderados_diretos": len(self.direct_reports),
        }


def load_identity(db: Database, employee_id: str, session_id: str = "") -> IdentityContext | None:
    """Resolve an identity through the ``hr.identity`` SECURITY DEFINER function."""
    with db.anonymous() as conn:
        data = conn.execute(text("SELECT hr.identity(:e)"), {"e": employee_id}).scalar()
    if not data:
        return None
    return IdentityContext(
        employee_id=data["id"],
        name=data["name"],
        email=data["email"],
        title=data["title"],
        unit_id=data["unit_id"],
        unit_path=tuple(data["unit_path"]),
        manager_id=data["manager_id"],
        location=data["location"],
        hire_date=date.fromisoformat(data["hire_date"]),
        direct_reports=frozenset(data["direct_reports"]),
        chain_reports=frozenset(data["chain_reports"]),
        hrbp_units=frozenset(data["hrbp_units"]),
        platform_roles=frozenset(data["platform_roles"]),
        session_id=session_id,
    )


def employee_id_for_email(db: Database, email: str) -> str | None:
    with db.anonymous() as conn:
        return conn.execute(text("SELECT hr.employee_id_for_email(:e)"), {"e": email}).scalar()
