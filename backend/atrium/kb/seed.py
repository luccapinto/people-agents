"""Load the knowledge base corpus (content/kb/manifest.yaml) into Postgres as the owner role."""

from __future__ import annotations

import json
import os

import yaml
from sqlalchemy import create_engine, text

from atrium.config import REPO_ROOT
from atrium.kb.embeddings import get_embedder
from atrium.kb.service import ingest

KB_DIR = REPO_ROOT / "content/kb"


def manifest() -> list[dict]:
    return yaml.safe_load((KB_DIR / "manifest.yaml").read_text())["knowledge_bases"]


def seed_knowledge(owner_url: str, embedder_kind: str | None = None) -> dict:
    embedder = get_embedder(embedder_kind or os.environ.get("ATRIUM_EMBEDDINGS", "hash"))
    engine = create_engine(owner_url)
    totals = {"knowledge_bases": 0, "documents": 0, "chunks": 0, "quarantined": 0, "embedder": embedder.name}
    with engine.begin() as c:
        owner = c.execute(text("SELECT employee_id FROM hr.platform_roles WHERE role = 'governance_admin' ORDER BY 1 LIMIT 1")).scalar()
        studio_owner = c.execute(text("SELECT id FROM hr.employees WHERE name = 'Mariana Costa'")).scalar()
        for kb in manifest():
            c.execute(text(
                """INSERT INTO app.knowledge_bases (id, name, description, audience, owner_id)
                   VALUES (:id, :n, :d, CAST(:a AS jsonb), :o)
                   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, audience = EXCLUDED.audience"""),
                {"id": kb["id"], "n": kb["name"], "d": kb.get("description", ""), "a": json.dumps(kb.get("audience") or {"type": "all"}),
                 "o": studio_owner if kb["id"] == "plataforma-dados" else owner})
            totals["knowledge_bases"] += 1
            for doc in kb["documents"]:
                path = KB_DIR / kb["id"] / doc
                result = ingest(c, embedder, kb["id"], doc, f"{kb['id']}/{doc}", "text/markdown", path.read_text())
                totals["documents"] += 1
                totals["chunks"] += result["chunks"]
                totals["quarantined"] += int(result["quarantined"])
    engine.dispose()
    return totals
