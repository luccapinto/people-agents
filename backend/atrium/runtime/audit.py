"""Append-only, hash-chained audit log.

Events are appended by the ``app.append_audit`` SECURITY DEFINER function, which takes an
advisory lock, links the event to the previous hash and computes
``sha256(prev_hash|id|ts|type|actor|subject|conversation|request|payload::text)``.
``verify_chain`` recomputes the same canonical form and reports the first broken link.
Payloads are PII-masked before they reach the database.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import Connection, text

from atrium.db.engine import Database
from atrium.guardrails.pii import mask_structure

GENESIS = "0" * 64


class AuditLog:
    def __init__(self, db: Database) -> None:
        self.db = db

    def append(
        self,
        type: str,
        *,
        actor: str | None = None,
        subject: str | None = None,
        conversation: str | None = None,
        request: str | None = None,
        payload: dict | None = None,
    ) -> int:
        body = json.dumps(mask_structure(payload or {}), ensure_ascii=False, default=str)
        with self.db.anonymous() as conn:
            return conn.execute(
                text("SELECT app.append_audit(:t, :a, :s, :c, :r, CAST(:p AS jsonb))"),
                {"t": type, "a": actor, "s": subject, "c": conversation, "r": request, "p": body},
            ).scalar_one()


@dataclass(frozen=True)
class ChainVerification:
    ok: bool
    checked: int
    broken_at: int | None
    reason: str

    def as_dict(self) -> dict:
        return {"ok": self.ok, "checked": self.checked, "broken_at": self.broken_at, "reason": self.reason}


def verify_chain(conn: Connection) -> ChainVerification:
    """Recompute every hash. ``conn`` must be able to read the table (governance or owner)."""
    rows = conn.execute(text(
        """SELECT id, prev_hash, hash, type, coalesce(actor_id, '') AS actor, coalesce(subject_id, '') AS subject,
                  coalesce(conversation_id, '') AS conversation, coalesce(request_id, '') AS request,
                  to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts, payload::text AS payload
           FROM app.audit_events ORDER BY id""")).all()
    prev = GENESIS
    for i, r in enumerate(rows):
        if r.prev_hash != prev:
            return ChainVerification(False, i, r.id, "prev_hash does not match the previous event")
        canonical = "|".join([prev, str(r.id), r.ts, r.type, r.actor, r.subject, r.conversation, r.request, r.payload])
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if digest != r.hash:
            return ChainVerification(False, i, r.id, "event content does not match its hash")
        prev = r.hash
    return ChainVerification(True, len(rows), None, "chain intact")
