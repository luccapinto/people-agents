"""HTTP API: dev IdP, SSE chat stream, confirmation endpoint, uploads and PDFs."""

import json

import pytest
from fastapi.testclient import TestClient

from atrium.api.app import create_app
from atrium.api.deps import set_services
from tests.conftest import PERSONA

pytestmark = pytest.mark.db


@pytest.fixture(scope="module")
def client(services):
    set_services(services)
    yield TestClient(create_app())
    set_services(None)


def login(client, persona: str) -> dict:
    token = client.post("/api/auth/login", json={"employee_id": PERSONA[persona]}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def sse(response) -> list[tuple[str, dict]]:
    out = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_requires_authentication(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer forged.token.value"}).status_code == 401


def test_dev_idp_only_signs_in_personas(client):
    assert client.post("/api/auth/login", json={"employee_id": "E1050"}).status_code == 403


def test_me_lists_only_visible_agents(client):
    me = client.get("/api/me", headers=login(client, "colaborador")).json()
    ids = {a["id"] for a in me["agents"]}
    assert "data_platform" in ids and "leadership" not in ids and "people_analytics" not in ids
    assert me["starters"] and "monitoradas" not in me["transparency_notice"] or me["transparency_notice"]
    gestora = {a["id"] for a in client.get("/api/me", headers=login(client, "gestora")).json()["agents"]}
    assert "leadership" in gestora


def test_chat_streams_events_and_confirmation_executes(client):
    h = login(client, "colaborador")
    r = client.post("/api/chat", json={"message": "Quero tirar férias de 23/11 a 07/12"}, headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = sse(r)
    kinds = [e for e, _ in events]
    assert kinds[0] == "message.start" and kinds[-1] == "message.end"
    assert {"trace.route", "trace.tool", "proposal", "text.delta", "usage"} <= set(kinds)
    proposal = next(d for e, d in events if e == "proposal")
    bad = client.post(f"/api/proposals/{proposal['id']}/confirm", json={"token": "x" * 40}, headers=h)
    assert bad.status_code == 403
    other = client.post(f"/api/proposals/{proposal['id']}/confirm", json={"token": proposal["token"]}, headers=login(client, "gestora"))
    assert other.status_code == 404
    ok = client.post(f"/api/proposals/{proposal['id']}/confirm", json={"token": proposal["token"]}, headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "executed"
    again = client.post(f"/api/proposals/{proposal['id']}/confirm", json={"token": proposal["token"]}, headers=h)
    assert again.status_code == 409
    rid = ok.json()["data"]["request_id"]
    from sqlalchemy import create_engine, text

    from tests.conftest import OWNER_URL

    e = create_engine(OWNER_URL)
    with e.begin() as c:
        c.execute(text("DELETE FROM hr.vacation_requests WHERE id = :id"), {"id": rid})
    e.dispose()


def test_conversations_are_listed_for_the_owner_only(client):
    h = login(client, "novata")
    client.post("/api/chat", json={"message": "Quem é o meu buddy?"}, headers=h)
    convs = client.get("/api/conversations", headers=h).json()
    assert convs
    msgs = client.get(f"/api/conversations/{convs[0]['id']}/messages", headers=h).json()
    assert [m["role"] for m in msgs][:2] == ["user", "assistant"]
    assert client.get(f"/api/conversations/{convs[0]['id']}/messages", headers=login(client, "colaborador")).json() == []


def test_payslip_pdf_is_a_real_pdf_with_embedded_fonts(client):
    r = client.get("/api/documents/payslip/2026-09", headers=login(client, "colaborador"))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    import io

    from pypdf import PdfReader

    page = PdfReader(io.BytesIO(r.content)).pages[0]
    fonts = page["/Resources"]["/Font"]
    def descriptor(font):
        font = font.get_object()
        if font.get("/Subtype") == "/Type0":  # composite (Identity-H) fonts keep the descriptor in the descendant
            font = font["/DescendantFonts"][0].get_object()
        return font["/FontDescriptor"].get_object()

    descriptors = [descriptor(fonts[k]) for k in fonts]
    assert descriptors and all(any(f in d for f in ("/FontFile", "/FontFile2", "/FontFile3")) for d in descriptors)
    assert "Demonstrativo de pagamento" in page.extract_text()


def test_step_up_challenge_and_verify(client):
    h = login(client, "colaborador")
    code = client.post("/api/auth/step-up/challenge", headers=h).json()["code"]
    assert client.post("/api/auth/step-up", json={"code": "000000" if code != "000000" else "111111"}, headers=h).status_code == 401
    assert client.post("/api/auth/step-up", json={"code": code}, headers=h).json()["ok"]


def test_upload_and_receipt_flow(client):
    h = login(client, "colaborador")
    receipt = "Táxi Rápido SP\nCNPJ 11.222.333/0001-81\nData: 25/09/2026\nCorrida aeroporto\nTOTAL R$ 92,40\n"
    up = client.post("/api/uploads", files={"file": ("taxi.txt", receipt.encode(), "text/plain")}, headers=h).json()
    assert up["readable"]
    r = client.post("/api/chat", json={"message": "Enviei o comprovante do táxi", "attachments": [up["upload_id"]]}, headers=h)
    events = sse(r)
    card = next(d["card"] for e, d in events if e == "card" and d["card"]["type"] == "receipt_extraction")
    assert card["data"]["fields"]["amount"] == 92.40 and card["data"]["fields"]["category"] == "transporte por aplicativo"
    assert any(e == "proposal" for e, _ in events)
