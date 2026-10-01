"""Governance console and Agent Studio endpoints."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text

from atrium.api.deps import current_identity, get_services, require_governance
from atrium.authz.identity import IdentityContext
from atrium.authz.policy import K_ANONYMITY_FLOOR
from atrium.runtime.audit import verify_chain
from atrium.services import Services
from atrium.studio import Studio, StudioError

console = APIRouter(prefix="/api/console")
studio = APIRouter(prefix="/api/studio")


# --------------------------------------------------------------------------- console
@console.get("/overview")
def overview(identity: IdentityContext = Depends(require_governance), s: Services = Depends(get_services)) -> dict:
    with s.db.scoped(identity.employee_id) as c:
        totals = c.execute(text(
            """SELECT count(*) AS turns, count(DISTINCT employee_id) AS people, count(DISTINCT conversation_id) AS conversations,
                      coalesce(sum(prompt_tokens + completion_tokens), 0) AS tokens, coalesce(sum(cost_usd), 0) AS cost,
                      count(*) FILTER (WHERE resolved) AS resolved
               FROM app.usage WHERE ts > now() - interval '30 days'""")).one()
        by_agent = c.execute(text(
            """SELECT a AS agent, count(*) AS turns, count(*) FILTER (WHERE resolved) AS resolved, coalesce(sum(cost_usd), 0) AS cost,
                      coalesce(sum(prompt_tokens + completion_tokens), 0) AS tokens
               FROM app.usage, unnest(agent_ids) a WHERE ts > now() - interval '30 days' GROUP BY a ORDER BY turns DESC""")).all()
        by_unit = c.execute(text(
            """SELECT unit_id, count(*) AS turns, coalesce(sum(cost_usd), 0) AS cost FROM app.usage
               WHERE ts > now() - interval '30 days' GROUP BY unit_id ORDER BY turns DESC""")).all()
        feedback = dict(c.execute(text("SELECT agent_id, sum(rating) FROM app.feedback GROUP BY agent_id")).all())
        events = c.execute(text(
            """SELECT type, count(*) FROM app.audit_events WHERE ts > now() - interval '30 days'
               AND type IN ('tool.denied', 'authz.denied', 'security.alert', 'guardrail.output_blocked', 'guardrail.injection',
                            'chat.sensitive', 'proposal.executed', 'proposal.rejected', 'transcript.access') GROUP BY type""")).all()
        guardrails = c.execute(text(
            """SELECT o ->> 'name' AS name, o ->> 'outcome' AS outcome, count(*) AS n
               FROM app.audit_events, jsonb_array_elements(payload -> 'outcomes') o
               WHERE type = 'guardrail.input' AND ts > now() - interval '30 days' GROUP BY 1, 2 ORDER BY n DESC""")).all()
        unanswered = c.execute(text("SELECT agent_id, question, created_at FROM app.unanswered ORDER BY created_at DESC LIMIT 15")).all()
    units = {u.id: u.name for u in _units(s, identity)}
    agents = {a.id: a.name for a in s.agents.visible_for(identity)}
    return {
        "window_days": 30,
        "totals": {"turns": totals.turns, "people": totals.people, "conversations": totals.conversations, "tokens": totals.tokens,
                   "cost_usd": float(totals.cost), "resolution_rate": round(totals.resolved / totals.turns, 3) if totals.turns else None},
        "by_agent": [{"agent": r.agent, "name": agents.get(r.agent, r.agent), "turns": r.turns, "resolved": r.resolved,
                      "cost_usd": float(r.cost), "tokens": r.tokens, "feedback": int(feedback.get(r.agent) or 0)} for r in by_agent],
        "by_unit": [{"unit": units.get(r.unit_id, r.unit_id), "turns": r.turns, "cost_usd": float(r.cost)} for r in by_unit],
        "security_events": {t: n for t, n in events},
        "guardrails": [{"name": g.name, "outcome": g.outcome, "count": g.n} for g in guardrails],
        "unanswered": [{"agent": agents.get(u.agent_id, u.agent_id), "question": u.question, "at": u.created_at.isoformat()} for u in unanswered],
    }


def _units(s: Services, identity: IdentityContext):
    with s.gateway.session(identity.employee_id) as hr:
        return hr.directory.units()


@console.get("/audit")
def audit(type: str | None = None, actor: str | None = None, limit: int = 100, before: int | None = None,
          identity: IdentityContext = Depends(require_governance), s: Services = Depends(get_services)) -> dict:
    limit = max(1, min(limit, 500))
    with s.db.scoped(identity.employee_id) as c:
        rows = c.execute(text(
            """SELECT id, ts, type, actor_id, subject_id, conversation_id, request_id, payload, prev_hash, hash
               FROM app.audit_events WHERE (:t = '' OR type LIKE :t || '%') AND (:a = '' OR actor_id = :a)
               AND (:b = 0 OR id < :b) ORDER BY id DESC LIMIT :l"""),
            {"t": type or "", "a": actor or "", "b": before or 0, "l": limit}).all()
        types = c.execute(text("SELECT type, count(*) FROM app.audit_events GROUP BY type ORDER BY type")).all()
    names = s._directory()
    return {"events": [{"id": r.id, "ts": r.ts.isoformat(), "type": r.type, "actor": r.actor_id, "actor_name": names.get(r.actor_id),
                        "subject": r.subject_id, "subject_name": names.get(r.subject_id), "conversation": r.conversation_id,
                        "request": r.request_id, "payload": r.payload, "hash": r.hash, "prev_hash": r.prev_hash} for r in rows],
            "types": {t: n for t, n in types}}


@console.get("/audit/verify")
def audit_verify(identity: IdentityContext = Depends(require_governance), s: Services = Depends(get_services)) -> dict:
    with s.db.scoped(identity.employee_id) as c:
        result = verify_chain(c).as_dict()
    s.audit.append("audit.verified", actor=identity.employee_id, payload=result)
    return result


POLICY_RULES = {
    "manager_can_view_team_compensation": ("enabled", bool),
    "k_anonymity_min": ("value", int),
    "retention_days": ("value", int),
    "dlp_secrets_mode": ("value", str),
    "dlp_customer_data_mode": ("value", str),
    "blocked_topics": ("value", list),
    "user_daily_token_budget": ("value", int),
    "user_rate_limit_per_minute": ("value", int),
    "transcript_grant_minutes": ("value", int),
}


@console.get("/policies")
def policies(identity: IdentityContext = Depends(require_governance), s: Services = Depends(get_services)) -> list[dict]:
    with s.db.scoped(identity.employee_id) as c:
        rows = c.execute(text("SELECT key, value, description, updated_by, updated_at FROM app.policies ORDER BY key")).all()
    names = s._directory()
    return [{"key": r.key, "value": r.value, "description": r.description, "updated_by": names.get(r.updated_by),
             "updated_at": r.updated_at.isoformat()} for r in rows]


class PolicyBody(BaseModel):
    value: bool | int | str | list[str]


@console.put("/policies/{key}")
def update_policy(key: str, body: PolicyBody, identity: IdentityContext = Depends(require_governance),
                  s: Services = Depends(get_services)) -> dict:
    if key not in POLICY_RULES:
        raise HTTPException(404, "unknown policy")
    field, kind = POLICY_RULES[key]
    v = body.value
    if not isinstance(v, kind) or (kind is int and isinstance(v, bool)):
        raise HTTPException(422, f"{key} expects {kind.__name__}")
    if key == "k_anonymity_min" and v < K_ANONYMITY_FLOOR:
        raise HTTPException(422, f"k-anonimato não pode ser menor que {K_ANONYMITY_FLOOR}")
    if key == "retention_days" and not 30 <= v <= 3650:
        raise HTTPException(422, "retenção entre 30 e 3650 dias")
    if key.startswith("dlp_") and v not in ("warn", "block"):
        raise HTTPException(422, "modo deve ser warn ou block")
    if kind is int and v < 1:
        raise HTTPException(422, "valor deve ser positivo")
    import json

    with s.db.scoped(identity.employee_id) as c:
        old = c.execute(text("SELECT value FROM app.policies WHERE key = :k"), {"k": key}).scalar_one()
        c.execute(text("UPDATE app.policies SET value = CAST(:v AS jsonb), updated_by = :u, updated_at = now() WHERE key = :k"),
                  {"v": json.dumps({field: v}), "u": identity.employee_id, "k": key})
    s.policy.store.invalidate()
    s.audit.append("policy.changed", actor=identity.employee_id, payload={"key": key, "old": old, "new": {field: v}})
    return {"key": key, "value": {field: v}}


@console.get("/conversations")
def conversation_index(identity: IdentityContext = Depends(require_governance), s: Services = Depends(get_services)) -> list[dict]:
    units = {u.id: u.name for u in _units(s, identity)}
    with s.db.scoped(identity.employee_id) as c:
        rows = c.execute(text("SELECT * FROM app.conversation_index(100)")).all()
    return [{"id": str(r.id), "unit": units.get(r.unit_id, r.unit_id), "created_at": r.created_at.isoformat(),
             "updated_at": r.updated_at.isoformat(), "messages": r.messages, "sensitive": r.sensitive, "agents": r.agents or []}
            for r in rows]


class AccessBody(BaseModel):
    justification: str = Field(..., min_length=20, max_length=500)


@console.post("/conversations/{conversation_id}/access")
def transcript_access(conversation_id: str, body: AccessBody, identity: IdentityContext = Depends(require_governance),
                      s: Services = Depends(get_services)) -> dict:
    minutes = int(s.policy.store.value("transcript_grant_minutes", 60))
    with s.db.scoped(identity.employee_id) as c:
        exists = c.execute(text("SELECT count(*) FROM app.conversation_index(100000) WHERE id = CAST(:c AS uuid)"), {"c": conversation_id}).scalar()
        if not exists:
            raise HTTPException(404, "conversation not found")
        c.execute(text("""INSERT INTO app.transcript_grants (conversation_id, grantee_id, justification, expires_at)
                          VALUES (CAST(:c AS uuid), :g, :j, now() + :ttl)"""),
                  {"c": conversation_id, "g": identity.employee_id, "j": body.justification, "ttl": timedelta(minutes=minutes)})
    s.audit.append("transcript.access", actor=identity.employee_id, conversation=conversation_id,
                   payload={"justification": body.justification, "minutes": minutes})
    with s.db.scoped(identity.employee_id) as c:
        owner = c.execute(text("SELECT app.conversation_owner(CAST(:c AS uuid))"), {"c": conversation_id}).scalar()
    return {"owner": owner, "expires_in_minutes": minutes, "messages": s.conversations.messages(identity.employee_id, conversation_id)}


# --------------------------------------------------------------------------- studio
def _studio(s: Services = Depends(get_services)) -> Studio:
    return Studio(s)


def _wrap(fn, *args):
    try:
        return fn(*args)
    except StudioError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@studio.get("/catalog")
def studio_catalog(identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return st.catalog(identity)


@studio.get("/agents")
def studio_agents(identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> list[dict]:
    return st.list(identity)


class SpecBody(BaseModel):
    spec: dict


@studio.post("/agents")
def studio_create(body: SpecBody, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.create, identity, body.spec)


@studio.get("/agents/{agent_id}")
def studio_get(agent_id: str, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.get, identity, agent_id)


@studio.put("/agents/{agent_id}")
def studio_update(agent_id: str, body: SpecBody, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.update, identity, agent_id, body.spec)


@studio.get("/agents/{agent_id}/documents")
def studio_documents(agent_id: str, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> list[dict]:
    return _wrap(st.documents, identity, agent_id)


@studio.post("/agents/{agent_id}/documents")
async def studio_upload(agent_id: str, file: UploadFile = File(...), identity: IdentityContext = Depends(current_identity),
                        st: Studio = Depends(_studio)) -> dict:
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "arquivo maior que 5 MB")
    name = file.filename or "documento.txt"
    if not name.lower().endswith((".md", ".txt", ".pdf", ".docx")):
        raise HTTPException(415, "envie Markdown, TXT, PDF ou DOCX")
    return _wrap(st.add_document, identity, agent_id, name, file.content_type or "", data)


@studio.post("/agents/{agent_id}/evaluate")
def studio_evaluate(agent_id: str, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.evaluate, identity, agent_id)


@studio.post("/agents/{agent_id}/submit")
def studio_submit(agent_id: str, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.submit, identity, agent_id)


class ReviewBody(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    note: str = Field(..., max_length=500)


@studio.post("/agents/{agent_id}/review")
def studio_review(agent_id: str, body: ReviewBody, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.review, identity, agent_id, body.decision == "approve", body.note)


class StatusBody(BaseModel):
    status: str


@studio.post("/agents/{agent_id}/status")
def studio_status(agent_id: str, body: StatusBody, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.set_status, identity, agent_id, body.status)


class RollbackBody(BaseModel):
    version: int


@studio.post("/agents/{agent_id}/rollback")
def studio_rollback(agent_id: str, body: RollbackBody, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.rollback, identity, agent_id, body.version)


@studio.get("/agents/{agent_id}/metrics")
def studio_metrics(agent_id: str, identity: IdentityContext = Depends(current_identity), st: Studio = Depends(_studio)) -> dict:
    return _wrap(st.metrics, identity, agent_id)
