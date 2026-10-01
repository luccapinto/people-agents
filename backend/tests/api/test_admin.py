"""Governance console and Agent Studio: lifecycle, gates, separation of duties, LGPD controls."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from atrium.api.app import create_app
from atrium.api.deps import set_services
from tests.conftest import OWNER_URL, PERSONA

pytestmark = pytest.mark.db

VPN_DOC = """# Guia de Acesso Remoto

## VPN NimbusConnect

Para acessar a VPN instale o cliente NimbusConnect pelo portal de software e entre com seu login corporativo e MFA.
Se o túnel cair, reinicie o cliente e verifique se o relógio do notebook está sincronizado.

## Perguntas frequentes

### A VPN funciona no celular?
Não. O acesso remoto é só pelo notebook corporativo.
"""

SPEC = {
    "name": "Acesso Remoto",
    "description": "Responde dúvidas sobre VPN NimbusConnect, acesso remoto e MFA para o time de Plataforma de Dados.",
    "instructions": "Responda com base no guia de acesso remoto, sempre com citação.",
    "audience": {"type": "units", "units": ["U11"]},
    "tools": ["kb_search", "ticket_open"],
    "routing": {"keywords": ["vpn", "nimbusconnect", "acesso remoto", "mfa"], "examples": ["Como configuro a VPN?"]},
    "evaluation": [
        {"kind": "routing", "question": "Como configuro a VPN NimbusConnect?"},
        {"kind": "citation", "question": "A VPN funciona no celular?"},
        {"kind": "refusal", "question": "Qual o salário da Maria Oliveira?"},
    ],
}


@pytest.fixture(scope="module")
def client(services):
    set_services(services)
    yield TestClient(create_app())
    set_services(None)


def h(client, persona):
    token = client.post("/api/auth/login", json={"employee_id": PERSONA[persona]}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_console_is_governance_only(client):
    for path in ("/api/console/overview", "/api/console/audit", "/api/console/policies", "/api/console/conversations"):
        assert client.get(path, headers=h(client, "gestora")).status_code == 403
        assert client.get(path, headers=h(client, "governanca")).status_code == 200


def test_overview_and_audit_verification(client):
    gov = h(client, "governanca")
    client.post("/api/chat", json={"message": "Qual é o meu plano de saúde?"}, headers=h(client, "colaborador"))
    o = client.get("/api/console/overview", headers=gov).json()
    assert o["totals"]["turns"] >= 1 and o["by_agent"]
    assert client.get("/api/console/audit/verify", headers=gov).json()["ok"]
    events = client.get("/api/console/audit?type=tool.", headers=gov).json()["events"]
    assert events and all(e["type"].startswith("tool.") for e in events)


def test_policy_changes_are_validated_and_audited(client):
    gov = h(client, "governanca")
    assert client.put("/api/console/policies/k_anonymity_min", json={"value": 3}, headers=gov).status_code == 422
    assert client.put("/api/console/policies/dlp_secrets_mode", json={"value": "ignore"}, headers=gov).status_code == 422
    r = client.put("/api/console/policies/retention_days", json={"value": 90}, headers=gov)
    assert r.status_code == 200
    audit = client.get("/api/console/audit?type=policy.changed", headers=gov).json()["events"]
    assert audit[0]["payload"]["key"] == "retention_days"
    client.put("/api/console/policies/retention_days", json={"value": 180}, headers=gov)


def test_transcript_access_requires_justification_and_is_audited(client):
    user = h(client, "colaborador")
    client.post("/api/chat", json={"message": "Quanto tenho de banco de horas?"}, headers=user)
    gov = h(client, "governanca")
    index = client.get("/api/console/conversations", headers=gov).json()
    assert index and all(set(i) == {"id", "unit", "created_at", "updated_at", "messages", "sensitive", "agents"} for i in index)
    conv = index[0]["id"]
    assert client.post(f"/api/console/conversations/{conv}/access", json={"justification": "curiosidade"}, headers=gov).status_code == 422
    r = client.post(f"/api/console/conversations/{conv}/access",
                    json={"justification": "Investigação do incidente de segurança INC-2026-114"}, headers=gov).json()
    assert r["owner"] and r["messages"]
    audit = client.get("/api/console/audit?type=transcript.access", headers=gov).json()["events"]
    assert audit[0]["conversation"] == conv and "INC-2026-114" in audit[0]["payload"]["justification"]


def test_studio_full_lifecycle(client, owner_engine):
    author, gov = h(client, "gestora"), h(client, "governanca")
    with owner_engine.begin() as c:
        c.execute(text("DELETE FROM app.agents WHERE id LIKE 'acesso_remoto%'"))
        c.execute(text("DELETE FROM app.knowledge_bases WHERE id LIKE 'agente-acesso-remoto%'"))
    assert client.post("/api/studio/agents", json={"spec": SPEC}, headers=h(client, "colaborador")).status_code == 403
    bad = dict(SPEC, tools=["kb_search", "team_member_compensation"])
    assert client.post("/api/studio/agents", json={"spec": bad}, headers=author).status_code == 400
    agent = client.post("/api/studio/agents", json={"spec": SPEC}, headers=author).json()
    aid = agent["id"]
    assert agent["versions"][0]["status"] == "draft"

    # Drafts are invisible to everyone but the author.
    assert aid not in {a["id"] for a in client.get("/api/me", headers=h(client, "colaborador")).json()["agents"]}
    up = client.post(f"/api/studio/agents/{aid}/documents", files={"file": ("vpn.md", VPN_DOC.encode(), "text/markdown")}, headers=author).json()
    assert up["chunks"] >= 2 and not up["quarantined"]

    assert client.post(f"/api/studio/agents/{aid}/submit", headers=author).status_code == 409  # gate: no evaluation yet
    ev = client.post(f"/api/studio/agents/{aid}/evaluate", headers=author).json()
    assert ev["ok"], ev
    assert client.post(f"/api/studio/agents/{aid}/submit", headers=author).json()["versions"][0]["status"] == "in_review"

    assert client.post(f"/api/studio/agents/{aid}/review", json={"decision": "approve", "note": "ok ok ok ok"}, headers=author).status_code == 403
    assert client.post(f"/api/studio/agents/{aid}/review", json={"decision": "approve", "note": "curto"}, headers=gov).status_code == 400
    approved = client.post(f"/api/studio/agents/{aid}/review", json={"decision": "approve", "note": "Somente leitura, público restrito."},
                           headers=gov).json()
    assert approved["status"] == "published" and approved["published_version"] == 1

    # Published: visible and routable for the unit, invisible elsewhere.
    me = client.get("/api/me", headers=h(client, "colaborador")).json()
    assert aid in {a["id"] for a in me["agents"]}
    assert aid not in {a["id"] for a in client.get("/api/me", headers=h(client, "novata")).json()["agents"]}
    r = client.post("/api/chat", json={"message": "Como configuro a VPN NimbusConnect?"}, headers=h(client, "colaborador"))
    assert f'"{aid}"' in r.text.split("event: trace.route", 1)[1].split("\n\n", 1)[0]

    # New version, approval, rollback.
    client.put(f"/api/studio/agents/{aid}", json={"spec": dict(SPEC, description=SPEC["description"] + " Inclui MFA.")}, headers=author)
    client.post(f"/api/studio/agents/{aid}/evaluate", headers=author)
    client.post(f"/api/studio/agents/{aid}/submit", headers=author)
    v2 = client.post(f"/api/studio/agents/{aid}/review", json={"decision": "approve", "note": "Ajuste de descrição aprovado."}, headers=gov).json()
    assert v2["published_version"] == 2 and [v["status"] for v in v2["versions"]] == ["published", "superseded"]
    back = client.post(f"/api/studio/agents/{aid}/rollback", json={"version": 1}, headers=gov).json()
    assert back["published_version"] == 1
    paused = client.post(f"/api/studio/agents/{aid}/status", json={"status": "paused"}, headers=author).json()
    assert paused["status"] == "paused"
    assert aid not in {a["id"] for a in client.get("/api/me", headers=h(client, "colaborador")).json()["agents"]}
    metrics = client.get(f"/api/studio/agents/{aid}/metrics", headers=gov).json()
    assert metrics["turns"] >= 1


def test_reviewer_cannot_approve_own_agent(client, owner_engine):
    gov = h(client, "governanca")
    with owner_engine.begin() as c:
        c.execute(text("DELETE FROM app.agents WHERE id LIKE 'auto_aprovacao%'"))
        c.execute(text("DELETE FROM app.knowledge_bases WHERE id LIKE 'agente-auto-aprovacao%'"))
    spec = dict(SPEC, name="Auto Aprovação", audience={"type": "all"})
    agent = client.post("/api/studio/agents", json={"spec": spec}, headers=gov).json()
    with owner_engine.begin() as c:  # force it into review to exercise the rule
        c.execute(text("UPDATE app.agent_versions SET status = 'in_review' WHERE agent_id = :a"), {"a": agent["id"]})
    r = client.post(f"/api/studio/agents/{agent['id']}/review", json={"decision": "approve", "note": "aprovando o meu"}, headers=gov)
    assert r.status_code == 403 and "Segregação" in r.text


def test_retention_purge_redacts_old_content(owner_engine):
    from atrium.retention import REMOVED, purge

    with owner_engine.begin() as c:
        conv = c.execute(text("INSERT INTO app.conversations (owner_id) VALUES (:o) RETURNING id"), {"o": PERSONA["novata"]}).scalar_one()
        c.execute(text("""INSERT INTO app.messages (conversation_id, owner_id, role, content, created_at)
                          VALUES (:c, :o, 'user', 'mensagem antiga', now() - interval '400 days')"""), {"c": conv, "o": PERSONA["novata"]})
    result = purge(OWNER_URL)
    assert result["messages_redacted"] >= 1
    with owner_engine.begin() as c:
        assert c.execute(text("SELECT content FROM app.messages WHERE conversation_id = :c"), {"c": conv}).scalar_one() == REMOVED
