"""Proposals: the only path from a model's intent to a write.

A write tool returns a ``ProposalDraft``. This service stores it with a random 256-bit
token (only the SHA-256 hash is kept) and streams the token to the user's client. The
model is told a proposal exists; it never sees the token. ``confirm`` is a separate,
authenticated request that checks owner, token, status, expiry, single use and (for
sensitive actions) a fresh step-up, then re-authorizes and runs the tool's executor.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import text

from atrium.authz.identity import IdentityContext
from atrium.runtime.tool import ProposalDraft, Risk, Tool, ToolContext, ToolError

if TYPE_CHECKING:
    from atrium.services import Services

PROPOSAL_TTL = timedelta(minutes=15)
STEP_UP_MAX_AGE = timedelta(minutes=5)


class ProposalError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ProposalService:
    def __init__(self, services: Services) -> None:
        self.s = services

    def create(self, ctx: ToolContext, t: Tool, draft: ProposalDraft) -> dict:
        token = secrets.token_urlsafe(32)
        subject = draft.subject_id or ctx.identity.employee_id
        with self.s.db.scoped(ctx.identity.employee_id) as c:
            row = c.execute(text(
                """INSERT INTO app.proposals (actor_id, subject_id, tool, agent_id, args, summary, details, risk, token_hash,
                       status, conversation_id, expires_at)
                   VALUES (:actor, :subject, :tool, :agent, CAST(:args AS jsonb), :summary, CAST(:details AS jsonb), :risk, :hash,
                       'pending', :conv, now() + :ttl) RETURNING id, expires_at"""),
                {"actor": ctx.identity.employee_id, "subject": subject, "tool": t.name, "agent": ctx.agent_id,
                 "args": json.dumps(draft.args, default=str, ensure_ascii=False), "summary": draft.summary,
                 "details": json.dumps(draft.details, default=str, ensure_ascii=False), "risk": t.risk.value,
                 "hash": _hash(token), "conv": ctx.conversation_id, "ttl": PROPOSAL_TTL}).one()
        self.s.audit.append("proposal.created", actor=ctx.identity.employee_id, subject=subject, conversation=ctx.conversation_id,
                            request=ctx.identity.request_id,
                            payload={"proposal": str(row.id), "tool": t.name, "risk": t.risk.value, "summary": draft.summary})
        return {
            "id": str(row.id), "token": token, "tool": t.name, "title": t.title, "agent_id": ctx.agent_id,
            "summary": draft.summary, "details": draft.details, "risk": t.risk.value,
            "step_up_required": t.risk is Risk.SENSITIVE, "expires_at": row.expires_at.isoformat(), "status": "pending",
        }

    def confirm(self, identity: IdentityContext, proposal_id: str, token: str) -> dict:
        from atrium.runtime.registry import all_tools

        with self.s.db.scoped(identity.employee_id) as c:
            row = c.execute(text(
                """SELECT id, actor_id, subject_id, tool, agent_id, args, summary, risk, token_hash, status, conversation_id,
                          expires_at < now() AS expired
                   FROM app.proposals WHERE id = CAST(:id AS uuid) FOR UPDATE"""), {"id": proposal_id}).first()
            if row is None:  # RLS hides other people's proposals: same answer as "does not exist"
                self._reject(identity, proposal_id, "not_found")
                raise ProposalError("not_found", "Proposta não encontrada para esta pessoa.", 404)
            if not hmac.compare_digest(row.token_hash, _hash(token or "")):
                self._reject(identity, proposal_id, "invalid_token")
                raise ProposalError("invalid_token", "Token de confirmação inválido.", 403)
            if row.status != "pending":
                self._reject(identity, proposal_id, "already_used")
                raise ProposalError("already_used", "Esta proposta já foi usada ou cancelada.", 409)
            if row.expired:
                self._reject(identity, proposal_id, "expired")
                raise ProposalError("expired", "A proposta expirou. Peça novamente ao assistente.", 410)
            if row.risk == Risk.SENSITIVE.value:
                fresh = c.execute(text(
                    "SELECT verified_at > now() - :age FROM app.step_ups WHERE employee_id = :e"),
                    {"e": identity.employee_id, "age": STEP_UP_MAX_AGE}).scalar()
                if not fresh:
                    raise ProposalError("step_up_required", "Confirme sua identidade para concluir esta ação sensível.", 401)
            claimed = c.execute(text(
                "UPDATE app.proposals SET status = 'executed', decided_at = now() WHERE id = :id AND status = 'pending'"),
                {"id": row.id}).rowcount
            if claimed != 1:
                raise ProposalError("already_used", "Esta proposta já foi usada.", 409)

        t = all_tools()[row.tool]
        ctx = ToolContext(identity=identity, services=self.s, agent_id=row.agent_id,
                          conversation_id=str(row.conversation_id) if row.conversation_id else None, subject_id=row.subject_id)
        # Re-authorize at execution time: roles or the org chart may have changed since the proposal.
        decision = self.s.policy.authorize(identity, t.action, row.subject_id) if t.subject != "none" else None
        if decision is not None and not decision.allowed:
            self._finalize(identity, row, "failed", {"error": decision.reason})
            raise ProposalError("denied", decision.reason, 403)
        try:
            assert t.executor is not None
            result = t.executor(ctx, dict(row.args))
        except (ToolError, PermissionError) as exc:
            self._finalize(identity, row, "failed", {"error": str(exc)})
            raise ProposalError("failed", str(exc), 422) from exc
        outcome = {"summary": result.summary, "data": result.data, "card": result.card.as_dict() if result.card else None}
        self._finalize(identity, row, "executed", outcome)
        if row.risk == Risk.SENSITIVE.value:
            self.s.audit.append("security.alert", actor=identity.employee_id, subject=row.subject_id,
                                payload={"reason": "sensitive_action_executed", "tool": row.tool, "proposal": str(row.id)})
        return {"id": str(row.id), "status": "executed", **outcome}

    def cancel(self, identity: IdentityContext, proposal_id: str) -> dict:
        with self.s.db.scoped(identity.employee_id) as c:
            n = c.execute(text(
                "UPDATE app.proposals SET status = 'cancelled', decided_at = now() WHERE id = CAST(:id AS uuid) AND status = 'pending'"),
                {"id": proposal_id}).rowcount
        if n != 1:
            raise ProposalError("not_found", "Proposta não encontrada ou já decidida.", 404)
        self.s.audit.append("proposal.cancelled", actor=identity.employee_id, payload={"proposal": proposal_id})
        return {"id": proposal_id, "status": "cancelled"}

    def _finalize(self, identity: IdentityContext, row, status: str, result: dict) -> None:
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text("UPDATE app.proposals SET status = :s, result = CAST(:r AS jsonb) WHERE id = :id"),
                      {"s": status, "r": json.dumps(result, default=str, ensure_ascii=False), "id": row.id})
        self.s.audit.append(f"proposal.{status}", actor=identity.employee_id, subject=row.subject_id,
                            conversation=str(row.conversation_id) if row.conversation_id else None,
                            payload={"proposal": str(row.id), "tool": row.tool, "result": str(result)[:300]})

    def _reject(self, identity: IdentityContext, proposal_id: str, code: str) -> None:
        self.s.audit.append("proposal.rejected", actor=identity.employee_id, payload={"proposal": proposal_id, "code": code})

    def record_step_up(self, identity: IdentityContext) -> None:
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text(
                """INSERT INTO app.step_ups (employee_id, verified_at) VALUES (:e, now())
                   ON CONFLICT (employee_id) DO UPDATE SET verified_at = now()"""), {"e": identity.employee_id})
        self.s.audit.append("auth.step_up", actor=identity.employee_id)
