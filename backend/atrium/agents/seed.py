"""Seed built-in agents (published v1, owned by platform governance) and the Studio-made
"Plataforma de Dados" agent with a realistic lifecycle history (draft → review → published)."""

from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import create_engine, text

from atrium.clock import REFERENCE_TODAY
from atrium.runtime.agents import agent_catalog


def seed_agents(owner_url: str) -> dict:
    engine = create_engine(owner_url)
    counts = {"builtin": 0, "studio": 0}
    with engine.begin() as c:
        gov = c.execute(text("SELECT employee_id FROM hr.platform_roles WHERE role = 'governance_admin' ORDER BY 1 LIMIT 1")).scalar_one()
        by_name = dict(c.execute(text("SELECT name, id FROM hr.employees")).all())
        for spec in agent_catalog()["agents"]:
            studio = spec.get("origin") == "studio"
            owner = by_name[spec["owner"]] if studio else gov
            unit = c.execute(text("SELECT unit_id FROM hr.employees WHERE id = :e"), {"e": owner}).scalar_one()
            c.execute(text(
                """INSERT INTO app.agents (id, owner_id, owner_unit, status, published_version, builtin, review_due)
                   VALUES (:id, :o, :u, 'published', 1, :b, :due)"""),
                {"id": spec["id"], "o": owner, "u": unit, "b": not studio, "due": REFERENCE_TODAY + timedelta(days=180)})
            body = json.dumps({k: v for k, v in spec.items() if k not in ("owner", "reviewer")}, ensure_ascii=False)
            if studio:
                reviewer = by_name[spec["reviewer"]]
                # Same shape as StudioService.evaluate() (ok and version gate the review step and label
                # the result); there was no run to describe, so the details stay empty.
                cases = spec.get("evaluation", [])
                evals = {"passed": len(cases), "total": len(cases), "ok": True, "ran_at": "2026-09-14", "version": 1,
                         "results": [{"question": e["question"], "kind": e["kind"], "passed": True, "detail": ""} for e in cases]}
                c.execute(text(
                    """INSERT INTO app.agent_versions (agent_id, version, spec, status, created_by, created_at, submitted_at, eval_result,
                           reviewed_by, reviewed_at, review_note)
                       VALUES (:id, 1, CAST(:s AS jsonb), 'published', :o, :created, :submitted, CAST(:ev AS jsonb), :r, :reviewed,
                               'Aprovado: só ferramentas de leitura e chamado; audiência restrita à área.')"""),
                    {"id": spec["id"], "s": body, "o": owner, "created": date(2026, 9, 10), "submitted": date(2026, 9, 14),
                     "ev": json.dumps(evals), "r": reviewer, "reviewed": date(2026, 9, 15)})
                counts["studio"] += 1
            else:
                c.execute(text(
                    """INSERT INTO app.agent_versions (agent_id, version, spec, status, created_by, reviewed_by, reviewed_at)
                       VALUES (:id, 1, CAST(:s AS jsonb), 'published', :o, :o, now())"""),
                    {"id": spec["id"], "s": body, "o": owner})
                counts["builtin"] += 1
    engine.dispose()
    return counts
