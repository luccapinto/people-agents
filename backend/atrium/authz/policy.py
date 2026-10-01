"""Policy engine: every authorization decision, in plain code, outside the model.

``authorize(ctx, action, subject)`` returns a ``Decision`` with the policy id and a reason
that is shown in the "Por dentro" panel and stored in the audit log. The model never
decides; tools call this before touching a port, and Postgres RLS enforces the same rules
again underneath.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from threading import Lock

from sqlalchemy import text

from atrium.authz.identity import IdentityContext
from atrium.db.engine import Database

MANAGER_CHAIN_ACTIONS = {"team.vacation.read", "team.time.read", "team.training.read", "team.profile.read", "team.onboarding.read"}
DIRECT_REPORT_ACTIONS = {"team.vacation.decide"}
K_ANONYMITY_FLOOR = 5


@dataclass(frozen=True)
class Decision:
    allowed: bool
    policy: str
    reason: str

    def as_dict(self) -> dict:
        return {"allowed": self.allowed, "policy": self.policy, "reason": self.reason}


ALLOW_SELF = Decision(True, "self_service", "O sujeito é a própria pessoa autenticada.")


class PolicyStore:
    """Governance switches from ``app.policies`` with a short cache."""

    def __init__(self, db: Database | None, ttl_s: float = 5.0, overrides: dict | None = None) -> None:
        self.db = db
        self.ttl_s = ttl_s
        self._cache: dict[str, dict] = dict(overrides or {})
        self._loaded_at = 0.0 if db else float("inf")
        self._lock = Lock()

    def _refresh(self) -> None:
        if self.db is None or time.monotonic() - self._loaded_at < self.ttl_s:
            return
        with self._lock, self.db.anonymous() as conn:
            self._cache = dict(conn.execute(text("SELECT app.policy_values()")).scalar() or {})
            self._loaded_at = time.monotonic()

    def invalidate(self) -> None:
        self._loaded_at = 0.0

    def get(self, key: str, default=None):
        self._refresh()
        return self._cache.get(key, default)

    def enabled(self, key: str) -> bool:
        return bool((self.get(key) or {}).get("enabled", False))

    def value(self, key: str, default=None):
        v = self.get(key)
        return v.get("value", default) if isinstance(v, dict) else default

    def all(self) -> dict:
        self._refresh()
        return json.loads(json.dumps(self._cache))


def unit_subtree(units: list[dict] | list, root_ids: set[str]) -> set[str]:
    """All unit ids under (and including) the given roots."""
    children: dict[str | None, list[str]] = {}
    for u in units:
        uid, parent = (u["id"], u["parent_id"]) if isinstance(u, dict) else (u.id, u.parent_id)
        children.setdefault(parent, []).append(uid)
    out: set[str] = set()
    stack = list(root_ids)
    while stack:
        uid = stack.pop()
        if uid in out:
            continue
        out.add(uid)
        stack.extend(children.get(uid, []))
    return out


class PolicyEngine:
    def __init__(self, store: PolicyStore) -> None:
        self.store = store

    def authorize(
        self,
        ctx: IdentityContext,
        action: str,
        subject_id: str | None = None,
        *,
        unit_ids: list[str] | None = None,
        all_units: list | None = None,
    ) -> Decision:
        if action.startswith("self."):
            if subject_id is None or subject_id == ctx.employee_id:
                return ALLOW_SELF
            return Decision(False, "self_service", "Ferramentas de autoatendimento só agem sobre a própria pessoa.")

        if action in MANAGER_CHAIN_ACTIONS:
            if not ctx.is_manager:
                return Decision(False, "manager_chain", "A pessoa autenticada não é gestora.")
            if subject_id in ctx.chain_reports:
                return Decision(True, "manager_chain", "O sujeito está na cadeia de liderança da pessoa autenticada.")
            return Decision(False, "manager_chain", "O sujeito não está na cadeia de liderança da pessoa autenticada.")

        if action in DIRECT_REPORT_ACTIONS:
            if subject_id in ctx.direct_reports:
                return Decision(True, "direct_report", "O sujeito é liderado direto da pessoa autenticada.")
            return Decision(False, "direct_report", "Somente o gestor imediato pode decidir este pedido.")

        if action == "team.compensation.read":
            if subject_id not in ctx.chain_reports:
                return Decision(False, "manager_chain", "O sujeito não está na cadeia de liderança da pessoa autenticada.")
            if not self.store.enabled("manager_can_view_team_compensation"):
                return Decision(False, "manager_can_view_team_compensation",
                                "Pela política vigente, gestores não veem salário nem holerite do time.")
            return Decision(True, "manager_can_view_team_compensation", "Política de governança permite ao gestor ver remuneração do time.")

        if action == "analytics.aggregate":
            if not ctx.is_hrbp:
                return Decision(False, "hrbp_scope", "Somente HR Business Partners consultam agregados de pessoas.")
            covered = unit_subtree(all_units or [], set(ctx.hrbp_units))
            requested = set(unit_ids or [])
            if requested and requested <= covered:
                return Decision(True, "hrbp_scope", "As unidades pedidas estão no escopo do HRBP.")
            return Decision(False, "hrbp_scope", "Há unidades fora do escopo do HRBP.")

        if action.startswith("governance."):
            if ctx.is_governance:
                return Decision(True, "governance_role", "Papel de administração de governança.")
            return Decision(False, "governance_role", "Requer o papel de administração de governança.")

        if action == "studio.author":
            if ctx.roles & {"agent_author", "governance_admin"}:
                return Decision(True, "studio_author", "Papel de autoria de agentes.")
            return Decision(False, "studio_author", "Requer o papel de autoria de agentes.")

        return Decision(False, "default_deny", f"Nenhuma política permite a ação {action}.")

    def k_anonymity(self) -> int:
        return max(K_ANONYMITY_FLOOR, int(self.store.value("k_anonymity_min", K_ANONYMITY_FLOOR)))
