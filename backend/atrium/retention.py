"""Retention: remove message content older than the ``retention_days`` policy.

Runs as the owner role (a scheduled job, e.g. a nightly cron of ``atrium purge``). Audit
events are kept: they hold only masked summaries and the hash chain.
"""

from __future__ import annotations

from sqlalchemy import create_engine, text

REMOVED = "[conteúdo removido pela política de retenção]"


def purge(owner_url: str) -> dict:
    engine = create_engine(owner_url)
    with engine.begin() as c:
        days = c.execute(text("SELECT (value ->> 'value')::int FROM app.policies WHERE key = 'retention_days'")).scalar() or 180
        n = c.execute(text(
            """UPDATE app.messages SET content = :removed, redacted = true, payload = jsonb_build_object('retention', true)
               WHERE created_at < now() - make_interval(days => :d) AND content <> :removed"""), {"removed": REMOVED, "d": days}).rowcount
        uploads = c.execute(text("DELETE FROM app.uploads WHERE created_at < now() - make_interval(days => :d) RETURNING path"),
                            {"d": days}).scalars().all()
        c.execute(text("SELECT app.append_audit('retention.purge', NULL, NULL, NULL, NULL, CAST(:p AS jsonb))"),
                  {"p": f'{{"messages": {n}, "uploads": {len(uploads)}, "days": {days}}}'})
    engine.dispose()
    from pathlib import Path

    for p in uploads:
        Path(p).unlink(missing_ok=True)
    return {"retention_days": days, "messages_redacted": n, "uploads_deleted": len(uploads)}
