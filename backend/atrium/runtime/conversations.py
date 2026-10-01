"""Conversation persistence (RLS: owner only, or a justified transcript grant)."""

from __future__ import annotations

import json

from sqlalchemy import text

from atrium.db.engine import Database
from atrium.guardrails.pii import mask_pii, mask_structure


class ConversationStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    def ensure(self, owner: str, conversation_id: str | None, playground: str | None = None) -> tuple[str, bool]:
        with self.db.scoped(owner) as c:
            if conversation_id:
                row = c.execute(text("SELECT id FROM app.conversations WHERE id = CAST(:id AS uuid) AND owner_id = :o"),
                                {"id": conversation_id, "o": owner}).first()
                if row:
                    return str(row.id), False
            cid = c.execute(text("INSERT INTO app.conversations (owner_id, playground_agent) VALUES (:o, :p) RETURNING id"),
                            {"o": owner, "p": playground}).scalar_one()
        return str(cid), True

    def add(self, owner: str, conversation_id: str, role: str, content: str, payload: dict | None = None,
            redacted: bool = False) -> str:
        stored, _ = mask_pii(content)
        with self.db.scoped(owner) as c:
            mid = c.execute(text(
                """INSERT INTO app.messages (conversation_id, owner_id, role, content, redacted, payload)
                   VALUES (CAST(:c AS uuid), :o, :r, :t, :red, CAST(:p AS jsonb)) RETURNING id"""),
                {"c": conversation_id, "o": owner, "r": role, "t": stored, "red": redacted or stored != content,
                 "p": json.dumps(mask_structure(payload or {}), ensure_ascii=False, default=str)}).scalar_one()
            c.execute(text("UPDATE app.conversations SET updated_at = now() WHERE id = CAST(:c AS uuid)"), {"c": conversation_id})
        return str(mid)

    def set_title(self, owner: str, conversation_id: str, title: str, sensitive: bool = False) -> None:
        with self.db.scoped(owner) as c:
            c.execute(text("UPDATE app.conversations SET title = :t, sensitive = sensitive OR :s WHERE id = CAST(:c AS uuid)"),
                      {"t": title[:80], "s": sensitive, "c": conversation_id})

    def history(self, owner: str, conversation_id: str, limit: int = 8) -> list[dict]:
        with self.db.scoped(owner) as c:
            rows = c.execute(text(
                """SELECT role, content FROM app.messages WHERE conversation_id = CAST(:c AS uuid)
                   ORDER BY created_at DESC LIMIT :n"""), {"c": conversation_id, "n": limit}).all()
        return [{"role": r.role, "content": r.content} for r in reversed(rows)]

    def last_agents(self, owner: str, conversation_id: str) -> list[str]:
        """Specialists that answered the previous assistant turn (for follow-up questions)."""
        with self.db.scoped(owner) as c:
            payload = c.execute(text(
                """SELECT payload FROM app.messages WHERE conversation_id = CAST(:c AS uuid) AND role = 'assistant'
                   ORDER BY created_at DESC LIMIT 1"""), {"c": conversation_id}).scalar()
        return list((payload or {}).get("agents") or [])

    def list(self, owner: str) -> list[dict]:
        with self.db.scoped(owner) as c:
            rows = c.execute(text(
                """SELECT id, title, playground_agent, sensitive, created_at, updated_at FROM app.conversations
                   WHERE owner_id = :o ORDER BY updated_at DESC LIMIT 50"""), {"o": owner}).all()
        return [{"id": str(r.id), "title": r.title, "playground_agent": r.playground_agent, "sensitive": r.sensitive,
                 "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat()} for r in rows]

    def messages(self, viewer: str, conversation_id: str) -> list[dict]:
        with self.db.scoped(viewer) as c:
            rows = c.execute(text(
                """SELECT id, role, content, redacted, payload, created_at FROM app.messages
                   WHERE conversation_id = CAST(:c AS uuid) ORDER BY created_at"""), {"c": conversation_id}).all()
        return [{"id": str(r.id), "role": r.role, "content": r.content, "redacted": r.redacted, "payload": r.payload,
                 "created_at": r.created_at.isoformat()} for r in rows]

    def recent_user_messages(self, owner: str, seconds: int = 60) -> int:
        with self.db.scoped(owner) as c:
            return c.execute(text(
                """SELECT count(*) FROM app.messages WHERE owner_id = :o AND role = 'user'
                   AND created_at > now() - make_interval(secs => :s)"""), {"o": owner, "s": seconds}).scalar_one()

    def tokens_today(self, owner: str) -> int:
        with self.db.scoped(owner) as c:
            return c.execute(text(
                """SELECT coalesce(sum(prompt_tokens + completion_tokens), 0) FROM app.usage
                   WHERE employee_id = :o AND ts > date_trunc('day', now())"""), {"o": owner}).scalar_one()

    def record_usage(self, owner: str, unit: str, conversation_id: str, agents: list[str], usage: dict, resolved: bool) -> None:
        with self.db.scoped(owner) as c:
            c.execute(text(
                """INSERT INTO app.usage (employee_id, unit_id, conversation_id, agent_ids, model, prompt_tokens, completion_tokens,
                       cost_usd, resolved) VALUES (:e, :u, CAST(:c AS uuid), :a, :m, :p, :ct, :cost, :r)"""),
                {"e": owner, "u": unit, "c": conversation_id, "a": agents, "m": usage["model"] or "none",
                 "p": usage["prompt_tokens"], "ct": usage["completion_tokens"], "cost": usage["cost_usd"], "r": resolved})

    def record_unanswered(self, owner: str, agent_id: str, question: str) -> None:
        with self.db.scoped(owner) as c:
            c.execute(text("INSERT INTO app.unanswered (agent_id, question) VALUES (:a, :q)"),
                      {"a": agent_id, "q": mask_pii(question)[0][:500]})
