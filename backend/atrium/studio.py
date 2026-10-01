"""Agent Studio: governed creation of collective agents.

Lifecycle: draft → (evaluation gate) → in_review → published → paused / archived, with
versions and rollback. Tools come only from the governed catalog; write/sensitive tools
flag the agent for governance approval. The reviewer must not be the author.
"""

from __future__ import annotations

import json
import re
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import text

from atrium.authz.identity import IdentityContext
from atrium.clock import today
from atrium.kb.chunking import to_markdown
from atrium.kb.service import ingest
from atrium.runtime.agents import lexicon, life_events
from atrium.runtime.intent import intent_model
from atrium.runtime.registry import agent_risk, all_tools, tool_catalog
from atrium.runtime.router import LexicalRouter
from atrium.text import fold

if TYPE_CHECKING:
    from atrium.services import Services

REVIEW_PERIOD_DAYS = 180
REFUSAL_MARKERS = ("nao posso", "nao tenho permissao", "so a propria pessoa", "nao consigo compartilhar", "fora do que posso")


class StudioError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", fold(name)).strip("_")
    return s[:40] or "agente"


def validate_spec(spec: dict, services: Services, identity: IdentityContext) -> dict:
    catalog = tool_catalog()
    tools = list(dict.fromkeys(spec.get("tools") or ["kb_search"]))
    unknown = [t for t in tools if t not in catalog]
    if unknown:
        raise StudioError(f"Ferramentas fora do catálogo governado: {', '.join(unknown)}")
    target_tools = [t for t in tools if catalog[t]["subject"] == "target"]
    if target_tools:
        raise StudioError("Ferramentas que agem sobre outras pessoas não podem ser usadas por agentes do Studio.")
    audience = spec.get("audience") or {"type": "all"}
    if audience.get("type") not in ("all", "roles", "units"):
        raise StudioError("Público inválido.")
    name = (spec.get("name") or "").strip()
    description = (spec.get("description") or "").strip()
    if len(name) < 3 or len(description) < 20:
        raise StudioError("Informe um nome e uma descrição (mínimo 20 caracteres) — o roteador usa a descrição.")
    evaluation = spec.get("evaluation") or []
    for e in evaluation:
        if e.get("kind") not in ("routing", "citation", "refusal") or not (e.get("question") or "").strip():
            raise StudioError("Cada pergunta de avaliação precisa de tipo (routing, citation, refusal) e texto.")
    return {
        "name": name, "description": description, "instructions": (spec.get("instructions") or "").strip(),
        "tone": (spec.get("tone") or "").strip(), "icon": spec.get("icon") or "bot", "audience": audience, "tools": tools,
        "knowledge": list(dict.fromkeys(spec.get("knowledge") or [])), "origin": "studio",
        "routing": {"keywords": [k.strip() for k in (spec.get("routing") or {}).get("keywords", []) if k.strip()][:30],
                    "examples": [x.strip() for x in (spec.get("routing") or {}).get("examples", []) if x.strip()][:20]},
        "evaluation": evaluation,
        "risk": agent_risk(tools),
    }


class Studio:
    def __init__(self, services: Services) -> None:
        self.s = services

    # ------------------------------------------------------------------ read
    def catalog(self, identity: IdentityContext) -> dict:
        tools = [{"name": n, "title": m["title"], "description": m["description"], "risk": m["risk"], "subject": m["subject"],
                  "requires_governance_review": m["risk"] != "read", "allowed_in_studio": m["subject"] != "target"}
                 for n, m in tool_catalog().items() if n in all_tools()]
        with self.s.db.scoped(identity.employee_id) as c:
            kbs = [dict(r._mapping) for r in c.execute(text("SELECT id, name, description, audience FROM app.knowledge_bases ORDER BY id"))]
        with self.s.gateway.session(identity.employee_id) as hr:
            units = [u.model_dump() for u in hr.directory.units()]
        return {"tools": tools, "knowledge_bases": kbs, "units": units, "roles": ["manager", "hrbp"]}

    def list(self, identity: IdentityContext) -> list[dict]:
        with self.s.db.scoped(identity.employee_id) as c:
            rows = c.execute(text(
                """SELECT a.id, a.owner_id, a.status, a.published_version, a.builtin, a.review_due, a.updated_at,
                          v.version AS latest_version, v.status AS latest_status, v.spec, e.name AS owner_name
                   FROM app.agents a
                   JOIN LATERAL (SELECT version, status, spec FROM app.agent_versions av WHERE av.agent_id = a.id
                                 ORDER BY version DESC LIMIT 1) v ON true
                   JOIN hr.employees e ON e.id = a.owner_id
                   ORDER BY a.builtin, a.updated_at DESC""")).all()
        return [{"id": r.id, "name": r.spec["name"], "description": r.spec["description"], "icon": r.spec.get("icon", "bot"),
                 "owner_id": r.owner_id, "owner_name": r.owner_name, "status": r.status, "published_version": r.published_version,
                 "latest_version": r.latest_version, "latest_status": r.latest_status, "builtin": r.builtin,
                 "review_due": r.review_due.isoformat() if r.review_due else None, "audience": r.spec.get("audience"),
                 "risk": r.spec.get("risk", "low"), "mine": r.owner_id == identity.employee_id} for r in rows]

    def get(self, identity: IdentityContext, agent_id: str) -> dict:
        with self.s.db.scoped(identity.employee_id) as c:
            a = c.execute(text("SELECT * FROM app.agents WHERE id = :id"), {"id": agent_id}).first()
            if a is None:
                raise StudioError("Agente não encontrado.", 404)
            versions = c.execute(text(
                """SELECT v.version, v.status, v.spec, v.created_by, v.created_at, v.submitted_at, v.eval_result, v.reviewed_by,
                          v.reviewed_at, v.review_note FROM app.agent_versions v WHERE v.agent_id = :id ORDER BY version DESC"""),
                {"id": agent_id}).all()
        names = self.s._directory()
        return {"id": a.id, "owner_id": a.owner_id, "owner_name": names.get(a.owner_id), "status": a.status,
                "published_version": a.published_version, "builtin": a.builtin,
                "review_due": a.review_due.isoformat() if a.review_due else None, "mine": a.owner_id == identity.employee_id,
                "versions": [{"version": v.version, "status": v.status, "spec": v.spec, "created_by": v.created_by,
                              "created_by_name": names.get(v.created_by), "reviewed_by_name": names.get(v.reviewed_by),
                              "created_at": v.created_at.isoformat(), "submitted_at": v.submitted_at.isoformat() if v.submitted_at else None,
                              "eval_result": v.eval_result, "reviewed_by": v.reviewed_by,
                              "reviewed_at": v.reviewed_at.isoformat() if v.reviewed_at else None, "review_note": v.review_note}
                             for v in versions]}

    def metrics(self, identity: IdentityContext, agent_id: str) -> dict:
        self.get(identity, agent_id)  # visibility check
        with self.s.db.scoped(identity.employee_id) as c:
            usage = c.execute(text(
                """SELECT count(*) AS turns, count(*) FILTER (WHERE resolved) AS resolved, count(DISTINCT employee_id) AS people,
                          coalesce(sum(cost_usd), 0) AS cost FROM app.usage WHERE :a = ANY(agent_ids)"""), {"a": agent_id}).one()
            fb = c.execute(text("SELECT coalesce(sum((rating = 1)::int), 0), coalesce(sum((rating = -1)::int), 0) FROM app.feedback WHERE agent_id = :a"),
                           {"a": agent_id}).one()
            gaps = c.execute(text("SELECT question, created_at FROM app.unanswered WHERE agent_id = :a ORDER BY created_at DESC LIMIT 20"),
                             {"a": agent_id}).all() if identity.is_governance else []
        return {"turns": usage.turns, "resolved": usage.resolved, "people": usage.people, "cost_usd": float(usage.cost),
                "resolution_rate": round(usage.resolved / usage.turns, 3) if usage.turns else None,
                "feedback_positive": fb[0], "feedback_negative": fb[1],
                "unanswered": [{"question": g.question, "at": g.created_at.isoformat()} for g in gaps]}

    # ------------------------------------------------------------------ write
    def create(self, identity: IdentityContext, spec: dict) -> dict:
        if not self.s.policy.authorize(identity, "studio.author").allowed:
            raise StudioError("Você não tem o papel de autoria de agentes.", 403)
        clean = validate_spec(spec, self.s, identity)
        base = _slug(clean["name"])
        kb_id = f"agente-{base.replace('_', '-')}"
        clean["knowledge"] = [kb_id, *[k for k in clean["knowledge"] if k != kb_id]]
        with self.s.db.scoped(identity.employee_id) as c:
            agent_id, n = base, 1
            # Other authors' drafts are invisible under RLS; availability is checked by a definer helper.
            while not c.execute(text("SELECT app.studio_ids_available(:a, :k)"), {"a": agent_id, "k": kb_id}).scalar():
                n += 1
                agent_id, kb_id = f"{base}_{n}", f"agente-{base.replace('_', '-')}-{n}"
                clean["knowledge"][0] = kb_id
            c.execute(text("INSERT INTO app.agents (id, owner_id, owner_unit, status, review_due) VALUES (:id, :o, :u, 'draft', :due)"),
                      {"id": agent_id, "o": identity.employee_id, "u": identity.unit_id, "due": today() + timedelta(days=REVIEW_PERIOD_DAYS)})
            c.execute(text("""INSERT INTO app.agent_versions (agent_id, version, spec, status, created_by)
                              VALUES (:id, 1, CAST(:s AS jsonb), 'draft', :o)"""),
                      {"id": agent_id, "s": json.dumps(clean, ensure_ascii=False), "o": identity.employee_id})
            c.execute(text("""INSERT INTO app.knowledge_bases (id, name, description, audience, owner_id)
                              VALUES (:k, :n, :d, CAST(:a AS jsonb), :o)"""),
                      {"k": kb_id, "n": f"Base do agente {clean['name']}", "d": clean["description"],
                       "a": json.dumps(clean["audience"]), "o": identity.employee_id})
        self.s.audit.append("studio.created", actor=identity.employee_id, payload={"agent": agent_id, "risk": clean["risk"]})
        return self.get(identity, agent_id)

    def update(self, identity: IdentityContext, agent_id: str, spec: dict) -> dict:
        current = self.get(identity, agent_id)
        if not current["mine"] or current["builtin"]:
            raise StudioError("Só o autor edita este agente.", 403)
        clean = validate_spec(spec, self.s, identity)
        latest = current["versions"][0]
        own_kb = next((k for k in latest["spec"].get("knowledge", []) if k.startswith("agente-")), None)
        if own_kb and own_kb not in clean["knowledge"]:
            clean["knowledge"].insert(0, own_kb)
        with self.s.db.scoped(identity.employee_id) as c:
            if latest["status"] in ("draft", "rejected"):
                c.execute(text("UPDATE app.agent_versions SET spec = CAST(:s AS jsonb), status = 'draft', eval_result = NULL WHERE agent_id = :id AND version = :v"),
                          {"s": json.dumps(clean, ensure_ascii=False), "id": agent_id, "v": latest["version"]})
                version = latest["version"]
            else:
                version = latest["version"] + 1
                c.execute(text("""INSERT INTO app.agent_versions (agent_id, version, spec, status, created_by)
                                  VALUES (:id, :v, CAST(:s AS jsonb), 'draft', :o)"""),
                          {"id": agent_id, "v": version, "s": json.dumps(clean, ensure_ascii=False), "o": identity.employee_id})
            c.execute(text("UPDATE app.agents SET updated_at = now() WHERE id = :id"), {"id": agent_id})
            if own_kb:  # the agent's own knowledge follows the agent's audience
                c.execute(text("UPDATE app.knowledge_bases SET audience = CAST(:a AS jsonb) WHERE id = :k"),
                          {"a": json.dumps(clean["audience"]), "k": own_kb})
        self.s.audit.append("studio.updated", actor=identity.employee_id, payload={"agent": agent_id, "version": version})
        return self.get(identity, agent_id)

    def add_document(self, identity: IdentityContext, agent_id: str, filename: str, mime: str, data: bytes) -> dict:
        current = self.get(identity, agent_id)
        if not current["mine"]:
            raise StudioError("Só o autor adiciona documentos à base do agente.", 403)
        kb_id = next((k for k in current["versions"][0]["spec"]["knowledge"] if k.startswith("agente-")), None)
        if kb_id is None:
            raise StudioError("Este agente não tem base própria.")
        markdown = to_markdown(data, mime, filename)
        if not markdown.strip():
            raise StudioError("Não consegui extrair texto do arquivo.")
        with self.s.db.scoped(identity.employee_id) as c:
            result = ingest(c, self.s.kb.embedder, kb_id, filename, f"{kb_id}/{filename}", mime, markdown, identity.employee_id)
        self.s.audit.append("studio.document", actor=identity.employee_id,
                            payload={"agent": agent_id, "document": filename, "chunks": result["chunks"], "quarantined": result["quarantined"]})
        return result

    def documents(self, identity: IdentityContext, agent_id: str) -> list[dict]:
        current = self.get(identity, agent_id)
        kbs = current["versions"][0]["spec"].get("knowledge", [])
        with self.s.db.scoped(identity.employee_id) as c:
            rows = c.execute(text(
                """SELECT d.kb_id, d.title, d.source, d.flags, d.created_at, count(ch.id) AS chunks FROM app.kb_documents d
                   LEFT JOIN app.kb_chunks ch ON ch.document_id = d.id WHERE d.kb_id = ANY(:k)
                   GROUP BY d.id ORDER BY d.created_at"""), {"k": kbs}).all()
        return [{"kb": r.kb_id, "title": r.title, "source": r.source, "flags": r.flags, "chunks": r.chunks,
                 "quarantined": "injection_suspected" in r.flags and "curator_approved" not in r.flags} for r in rows]

    def evaluate(self, identity: IdentityContext, agent_id: str) -> dict:
        from atrium.runtime.orchestrator import Orchestrator

        current = self.get(identity, agent_id)
        if not current["mine"]:
            raise StudioError("Só o autor roda a avaliação.", 403)
        latest = current["versions"][0]
        spec = latest["spec"]
        cases = spec.get("evaluation") or []
        if len(cases) < 3 or {c["kind"] for c in cases} != {"routing", "citation", "refusal"}:
            raise StudioError("Inclua pelo menos uma pergunta de cada tipo: roteamento, resposta com citação e recusa.")
        draft = self.s.agents.draft_for_owner(agent_id, identity)
        assert draft is not None
        visible = [a for a in self.s.agents.visible_for(identity) if a.id != agent_id] + [draft]
        router = LexicalRouter([a.profile() for a in visible], life_events(), lexicon(), intent_model())
        results = []
        for case in cases:
            q = case["question"]
            if case["kind"] == "routing":
                d = router.route(q, [a.id for a in visible])
                ok = agent_id in d.agents
                detail = f"roteado para: {', '.join(d.agents)} ({d.mode})"
            else:
                events = list(Orchestrator(self.s).run(identity, None, q, None, playground=agent_id))
                answer = "".join(e["data"]["delta"] for e in events if e["event"] == "text.delta")
                cites = [e["data"] for e in events if e["event"] == "citation"]
                if case["kind"] == "citation":
                    want = case.get("expect_kb")
                    ok = bool(cites) and (not want or any(c["kb"] == want for c in cites))
                    detail = f"{len(cites)} citação(ões): " + ", ".join(sorted({c['document'] for c in cites}))
                else:
                    denied = any(e["event"] == "trace.authz" and not e["data"]["decision"]["allowed"] for e in events) or any(
                        e["event"] == "trace.guardrail" and e["data"]["outcome"] == "block" for e in events)
                    ok = denied or any(m in fold(answer) for m in REFUSAL_MARKERS)
                    detail = "recusou" if ok else "não recusou"
            results.append({"kind": case["kind"], "question": q, "passed": ok, "detail": detail})
        passed = sum(r["passed"] for r in results)
        result = {"passed": passed, "total": len(results), "ok": passed == len(results), "results": results,
                  "ran_at": today().isoformat(), "version": latest["version"]}
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text("UPDATE app.agent_versions SET eval_result = CAST(:r AS jsonb) WHERE agent_id = :id AND version = :v"),
                      {"r": json.dumps(result, ensure_ascii=False), "id": agent_id, "v": latest["version"]})
        self.s.audit.append("studio.evaluated", actor=identity.employee_id,
                            payload={"agent": agent_id, "version": latest["version"], "passed": passed, "total": len(results)})
        return result

    def submit(self, identity: IdentityContext, agent_id: str) -> dict:
        current = self.get(identity, agent_id)
        latest = current["versions"][0]
        if not current["mine"]:
            raise StudioError("Só o autor envia para revisão.", 403)
        if latest["status"] != "draft":
            raise StudioError("Só rascunhos vão para revisão.")
        if not (latest["eval_result"] or {}).get("ok"):
            raise StudioError("A avaliação automática precisa passar antes da revisão.", 409)
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text("UPDATE app.agent_versions SET status = 'in_review', submitted_at = now() WHERE agent_id = :id AND version = :v"),
                      {"id": agent_id, "v": latest["version"]})
            if current["published_version"] is None:
                c.execute(text("UPDATE app.agents SET status = 'in_review', updated_at = now() WHERE id = :id"), {"id": agent_id})
        self.s.audit.append("studio.submitted", actor=identity.employee_id, payload={"agent": agent_id, "version": latest["version"]})
        return self.get(identity, agent_id)

    def review(self, identity: IdentityContext, agent_id: str, approve: bool, note: str) -> dict:
        if not identity.is_governance:
            raise StudioError("Revisão exige o papel de governança.", 403)
        current = self.get(identity, agent_id)
        pending = next((v for v in current["versions"] if v["status"] == "in_review"), None)
        if pending is None:
            raise StudioError("Não há versão em revisão.")
        if pending["created_by"] == identity.employee_id or current["owner_id"] == identity.employee_id:
            raise StudioError("Segregação de funções: quem cria o agente não pode aprová-lo.", 403)
        if len(note.strip()) < 10:
            raise StudioError("Registre uma justificativa da decisão (mínimo 10 caracteres).")
        with self.s.db.scoped(identity.employee_id) as c:
            if approve:
                c.execute(text("UPDATE app.agent_versions SET status = 'superseded' WHERE agent_id = :id AND status = 'published'"), {"id": agent_id})
                c.execute(text("""UPDATE app.agent_versions SET status = 'published', reviewed_by = :r, reviewed_at = now(), review_note = :n
                                  WHERE agent_id = :id AND version = :v"""),
                          {"r": identity.employee_id, "n": note, "id": agent_id, "v": pending["version"]})
                c.execute(text("UPDATE app.agents SET status = 'published', published_version = :v, updated_at = now(), review_due = :due WHERE id = :id"),
                          {"v": pending["version"], "id": agent_id, "due": today() + timedelta(days=REVIEW_PERIOD_DAYS)})
            else:
                c.execute(text("""UPDATE app.agent_versions SET status = 'rejected', reviewed_by = :r, reviewed_at = now(), review_note = :n
                                  WHERE agent_id = :id AND version = :v"""),
                          {"r": identity.employee_id, "n": note, "id": agent_id, "v": pending["version"]})
                if current["published_version"] is None:
                    c.execute(text("UPDATE app.agents SET status = 'draft', updated_at = now() WHERE id = :id"), {"id": agent_id})
        self.s.audit.append("studio.approved" if approve else "studio.rejected", actor=identity.employee_id, subject=current["owner_id"],
                            payload={"agent": agent_id, "version": pending["version"], "note": note})
        return self.get(identity, agent_id)

    def set_status(self, identity: IdentityContext, agent_id: str, status: str) -> dict:
        current = self.get(identity, agent_id)
        if not (current["mine"] or identity.is_governance):
            raise StudioError("Sem permissão.", 403)
        if status not in ("paused", "published", "archived"):
            raise StudioError("Status inválido.")
        if status == "published" and current["published_version"] is None:
            raise StudioError("Este agente nunca foi aprovado.", 409)
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text("UPDATE app.agents SET status = :s, updated_at = now() WHERE id = :id"), {"s": status, "id": agent_id})
        self.s.audit.append("studio.status", actor=identity.employee_id, payload={"agent": agent_id, "status": status})
        return self.get(identity, agent_id)

    def rollback(self, identity: IdentityContext, agent_id: str, version: int) -> dict:
        current = self.get(identity, agent_id)
        if not (current["mine"] or identity.is_governance):
            raise StudioError("Sem permissão.", 403)
        target = next((v for v in current["versions"] if v["version"] == version), None)
        if target is None or target["status"] not in ("published", "superseded"):
            raise StudioError("Só é possível voltar para uma versão que já foi aprovada.", 409)
        with self.s.db.scoped(identity.employee_id) as c:
            c.execute(text("UPDATE app.agent_versions SET status = 'superseded' WHERE agent_id = :id AND status = 'published'"), {"id": agent_id})
            c.execute(text("UPDATE app.agent_versions SET status = 'published' WHERE agent_id = :id AND version = :v"), {"id": agent_id, "v": version})
            c.execute(text("UPDATE app.agents SET published_version = :v, status = 'published', updated_at = now() WHERE id = :id"),
                      {"v": version, "id": agent_id})
        self.s.audit.append("studio.rollback", actor=identity.employee_id, payload={"agent": agent_id, "version": version})
        return self.get(identity, agent_id)
