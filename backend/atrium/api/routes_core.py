"""Auth, profile, chat (SSE), conversations, proposals, uploads, documents, feedback."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from atrium.api.deps import current_identity, get_services
from atrium.authn import check_step_up_code, issue_dev_token, step_up_code
from atrium.authz.identity import IdentityContext, load_identity
from atrium.branding import branding
from atrium.clock import today
from atrium.config import REPO_ROOT
from atrium.receipts import extract_text
from atrium.runtime.agents import agent_catalog
from atrium.runtime.orchestrator import Orchestrator
from atrium.runtime.proposals import ProposalError
from atrium.services import Services
from atrium.tools._util import company_policies

router = APIRouter(prefix="/api")
UPLOAD_DIR = REPO_ROOT / "backend/var/uploads"
MAX_UPLOAD = 5 * 1024 * 1024
ALLOWED_MIME = {"application/pdf", "text/plain", "image/png", "image/jpeg"}


def _personas() -> list[dict]:
    data = json.loads((REPO_ROOT / "shared/generated/dataset.json").read_text())
    emp = {e["id"]: e for e in data["employees"]}
    return [p | {"title": emp[p["employee_id"]]["title"]} for p in data["personas"]]


@router.get("/health")
def health() -> dict:
    return {"ok": True, "product": branding()["productName"]}


@router.get("/auth/personas")
def personas(s: Services = Depends(get_services)) -> list[dict]:
    if not s.settings.dev_idp_enabled:
        raise HTTPException(404, "development identity provider disabled")
    return _personas()


class LoginBody(BaseModel):
    employee_id: str


@router.post("/auth/login")
def login(body: LoginBody, s: Services = Depends(get_services)) -> dict:
    if not s.settings.dev_idp_enabled:
        raise HTTPException(404, "development identity provider disabled")
    if body.employee_id not in {p["employee_id"] for p in _personas()}:
        raise HTTPException(403, "only demo personas can sign in through the development IdP")
    identity = load_identity(s.db, body.employee_id)
    if identity is None:
        raise HTTPException(404, "unknown employee")
    s.audit.append("auth.login", actor=identity.employee_id, payload={"idp": "dev"})
    return {"token": issue_dev_token(s.settings.dev_jwt_secret, identity.employee_id)}


def _role_key(identity: IdentityContext) -> str:
    if identity.is_governance:
        return "governance"
    if identity.is_hrbp:
        return "hrbp"
    if identity.is_manager:
        return "manager"
    if (today() - identity.hire_date).days <= 90:
        return "newhire"
    return "employee"


@router.get("/me")
def me(identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> dict:
    agents = [a.public() for a in s.agents.visible_for(identity)]
    starters = agent_catalog()["starters"]
    notice = company_policies()["governance"]["transparency_notice"].replace("{product}", branding()["productName"])
    return {
        "employee_id": identity.employee_id, "name": identity.name, "email": identity.email, "title": identity.title,
        "unit_id": identity.unit_id, "roles": sorted(identity.roles), "hire_date": identity.hire_date.isoformat(),
        "agents": agents, "starters": starters[_role_key(identity)], "transparency_notice": notice, "branding": branding(),
    }


@router.post("/auth/step-up/challenge")
def step_up_challenge(identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> dict:
    """Dev IdP "sends" the one-time code; a real IdP would push it to the user's device."""
    if not s.settings.dev_idp_enabled:
        raise HTTPException(400, "use your identity provider to re-authenticate")
    return {"delivery": "dev", "code": step_up_code(s.settings.dev_jwt_secret, identity.employee_id),
            "message": "Em produção o código chega pelo aplicativo autenticador. No ambiente de demonstração ele é exibido aqui."}


class StepUpBody(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)


@router.post("/auth/step-up")
def step_up(body: StepUpBody, identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> dict:
    if not check_step_up_code(s.settings.dev_jwt_secret, identity.employee_id, body.code):
        s.audit.append("auth.step_up_failed", actor=identity.employee_id)
        raise HTTPException(401, "código inválido")
    s.proposals.record_step_up(identity)
    return {"ok": True}


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: str | None = None
    attachments: list[str] = Field(default_factory=list, max_length=3)
    playground_agent: str | None = None


def _sse(events) -> bytes:
    for e in events:
        yield f"event: {e['event']}\ndata: {json.dumps(e['data'], ensure_ascii=False, default=str)}\n\n".encode()


@router.post("/chat")
def chat(body: ChatBody, identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)):
    attachments = []
    if body.attachments:
        with s.db.scoped(identity.employee_id) as c:
            rows = c.execute(text("SELECT id, filename FROM app.uploads WHERE id = ANY(CAST(:ids AS uuid[]))"),
                             {"ids": body.attachments}).all()
        attachments = [{"upload_id": str(r.id), "filename": r.filename} for r in rows]
    orchestrator = Orchestrator(s, stream_delay_s=0.012)
    stream = orchestrator.run(identity, body.conversation_id, body.message, attachments, body.playground_agent)
    return StreamingResponse(_sse(stream), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/conversations")
def conversations(identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> list[dict]:
    return s.conversations.list(identity.employee_id)


@router.get("/conversations/{conversation_id}/messages")
def conversation_messages(conversation_id: str, identity: IdentityContext = Depends(current_identity),
                          s: Services = Depends(get_services)) -> list[dict]:
    try:
        return s.conversations.messages(identity.employee_id, conversation_id)
    except Exception as exc:
        raise HTTPException(404, "conversation not found") from exc


class ConfirmBody(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


@router.post("/proposals/{proposal_id}/confirm")
def confirm(proposal_id: str, body: ConfirmBody, identity: IdentityContext = Depends(current_identity),
            s: Services = Depends(get_services)) -> dict:
    try:
        return s.proposals.confirm(identity, proposal_id, body.token)
    except ProposalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc


@router.post("/proposals/{proposal_id}/cancel")
def cancel(proposal_id: str, identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> dict:
    try:
        return s.proposals.cancel(identity, proposal_id)
    except ProposalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc


@router.post("/uploads")
async def upload(file: UploadFile = File(...), identity: IdentityContext = Depends(current_identity),
                 s: Services = Depends(get_services)) -> dict:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "arquivo maior que 5 MB")
    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME:
        raise HTTPException(415, "envie PDF, PNG, JPG ou TXT")
    digest = hashlib.sha256(data).hexdigest()
    folder = UPLOAD_DIR / identity.employee_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{digest}{Path(file.filename or 'arquivo').suffix.lower()[:6]}"
    path.write_bytes(data)
    content = extract_text(data, mime, file.filename or "")
    with s.db.scoped(identity.employee_id) as c:
        uid = c.execute(text(
            """INSERT INTO app.uploads (owner_id, filename, mime, sha256, size_bytes, path, text_content)
               VALUES (:o, :f, :m, :h, :n, :p, :t) RETURNING id"""),
            {"o": identity.employee_id, "f": (file.filename or "arquivo")[:120], "m": mime, "h": digest, "n": len(data),
             "p": str(path), "t": content}).scalar_one()
    s.audit.append("upload.created", actor=identity.employee_id, payload={"upload": str(uid), "mime": mime, "bytes": len(data)})
    return {"upload_id": str(uid), "filename": file.filename, "size": len(data), "readable": bool(content.strip())}


@router.get("/documents/payslip/{month}")
def payslip_pdf(month: str, kind: str = "monthly", identity: IdentityContext = Depends(current_identity),
                s: Services = Depends(get_services)) -> Response:
    from atrium.pdf.render import render

    with s.gateway.session(identity.employee_id) as hr:
        slip = hr.payroll.payslip(identity.employee_id, month, kind)
        person = hr.directory.get(identity.employee_id)
    if slip is None:
        raise HTTPException(404, "payslip not found")
    s.audit.append("document.download", actor=identity.employee_id, subject=identity.employee_id,
                   payload={"kind": "payslip", "month": month})
    pdf = render("payslip.html", slip=slip.model_dump(mode="json"), person=person.model_dump(mode="json"))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="holerite-{month}.pdf"'})


@router.get("/documents/issued/{document_id}")
def issued_pdf(document_id: str, identity: IdentityContext = Depends(current_identity), s: Services = Depends(get_services)) -> Response:
    from atrium.pdf.render import render

    with s.gateway.session(identity.employee_id) as hr:
        doc = hr.documents.get(document_id)
        if doc is None:
            raise HTTPException(404, "document not found")
        person = hr.directory.get(identity.employee_id)
        private = hr.directory.private(identity.employee_id)
        figures = hr.payroll.income_statement(identity.employee_id, int(doc.params["year"])).model_dump() if doc.kind == "income_statement" else None
    s.audit.append("document.download", actor=identity.employee_id, subject=identity.employee_id, payload={"kind": doc.kind, "id": doc.id})
    pdf = render("letter.html", doc=doc.model_dump(mode="json"), person=person.model_dump(mode="json"),
                 cpf=private.cpf if private else "-", figures=figures, issued_on=doc.issued_on)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{doc.kind}-{doc.id}.pdf"'})


class FeedbackBody(BaseModel):
    rating: int = Field(..., ge=-1, le=1)
    agent_id: str | None = None
    comment: str | None = Field(None, max_length=500)


@router.post("/messages/{message_id}/feedback")
def feedback(message_id: str, body: FeedbackBody, identity: IdentityContext = Depends(current_identity),
             s: Services = Depends(get_services)) -> dict:
    if body.rating == 0:
        raise HTTPException(422, "rating must be -1 or 1")
    with s.db.scoped(identity.employee_id) as c:
        c.execute(text("INSERT INTO app.feedback (message_id, employee_id, agent_id, rating, comment) VALUES (CAST(:m AS uuid), :e, :a, :r, :c)"),
                  {"m": message_id, "e": identity.employee_id, "a": body.agent_id, "r": body.rating, "c": body.comment})
    return {"ok": True}
