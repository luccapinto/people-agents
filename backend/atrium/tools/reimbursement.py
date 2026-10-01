"""Reimbursement tools (agent: Reembolsos e Despesas). Receipt content is untrusted data."""

from __future__ import annotations

from datetime import date
from datetime import date as Date

from pydantic import Field
from sqlalchemy import text

from atrium.receipts import ReceiptFields, parse_receipt, validate
from atrium.runtime.nlu import contains_phrase
from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolError, ToolResult
from atrium.text import fold
from atrium.tools._util import company_policies, d, money


def load_upload(ctx: ToolContext, upload_id: str) -> dict:
    """Owner-only by RLS: someone else's upload id simply does not exist."""
    try:
        with ctx.services.db.scoped(ctx.identity.employee_id) as c:
            row = c.execute(text("SELECT id, filename, mime, text_content FROM app.uploads WHERE id = CAST(:id AS uuid)"),
                            {"id": upload_id}).first()
    except Exception as exc:  # malformed uuid
        raise ToolError("Comprovante não encontrado.") from exc
    if row is None:
        raise ToolError("Comprovante não encontrado.")
    return dict(row._mapping)


class ExtractArgs(Args):
    upload_id: str = Field(..., description="Identificador do arquivo enviado")


@tool("reimbursement_extract_receipt", params=ExtractArgs, action="self.reimbursement.read")
def reimbursement_extract_receipt(ctx: ToolContext, args: ExtractArgs) -> ToolResult:
    up = load_upload(ctx, args.upload_id)
    if not up["text_content"].strip():
        return ToolResult.fail("Não consegui ler o texto deste arquivo. Envie o comprovante em PDF ou informe valor, data e CNPJ.")
    fields = parse_receipt(up["text_content"])
    policy = company_policies()["reimbursement"]
    issues = validate(fields, None, ctx.today, policy)
    if fields.injection_signals:
        ctx.services.audit.append("guardrail.injection", actor=ctx.identity.employee_id, conversation=ctx.conversation_id,
                                  payload={"source": "receipt", "upload": args.upload_id, "signals": fields.injection_signals})
    ok = not [i for i in issues if i["severity"] == "error"]
    data = {"upload_id": args.upload_id, "filename": up["filename"], "fields": fields.as_dict(), "issues": issues,
            "valid": ok, "categories": list(policy["categories"].keys())}
    summary = "Li o comprovante: " + ", ".join(filter(None, [
        f"valor {money(fields.amount)}" if fields.amount is not None else None,
        f"data {d(fields.date)}" if fields.date else None,
        f"estabelecimento {fields.merchant}" if fields.merchant else None,
        f"categoria sugerida {fields.category}" if fields.category else None])) + "."
    summary += " Está dentro da política." if ok else " Há pendências: " + " ".join(i["message"] for i in issues if i["severity"] == "error")
    if fields.injection_signals:
        summary += " O arquivo continha instruções escondidas, que foram ignoradas."
    proposal = None
    if ok:
        payload = {"upload_id": args.upload_id, "category": fields.category, "amount": fields.amount,
                   "date": fields.date.isoformat(), "description": f"{fields.category} — {fields.merchant or up['filename']}"}
        proposal = ProposalDraft(summary=f"Pedir reembolso de {money(fields.amount)} ({fields.category})",
                                 details=[{"label": "Categoria", "value": fields.category}, {"label": "Valor", "value": money(fields.amount)},
                                          {"label": "Data", "value": d(fields.date)}, {"label": "Estabelecimento", "value": fields.merchant or "-"},
                                          {"label": "Aprovação", "value": policy["approval"]}],
                                 args=payload, tool="reimbursement_submit")
    return ToolResult(data=data, summary=summary, card=Card("receipt_extraction", data), proposal=proposal)


class SubmitArgs(Args):
    upload_id: str = Field(..., description="Identificador do comprovante enviado")
    category: str = Field(..., description="Categoria da política")
    amount: float = Field(..., gt=0, description="Valor em reais")
    date: Date = Field(..., description="Data da despesa (AAAA-MM-DD)")
    description: str = Field("", max_length=300, description="Descrição curta")


def _check(ctx: ToolContext, args: dict) -> tuple[dict, list[dict]]:
    up = load_upload(ctx, args["upload_id"])
    parsed = parse_receipt(up["text_content"])
    fields = ReceiptFields(args["amount"], date.fromisoformat(str(args["date"])), parsed.cnpj, parsed.merchant,
                           args["category"], parsed.items_flagged, parsed.injection_signals)
    return up, validate(fields, args["category"], ctx.today, company_policies()["reimbursement"])


def _execute_submit(ctx: ToolContext, args: dict) -> ToolResult:
    up, issues = _check(ctx, args)
    errors = [i for i in issues if i["severity"] == "error"]
    if errors:
        raise ToolError(errors[0]["message"])
    parsed = parse_receipt(up["text_content"])
    with ctx.hr() as hr:
        r = hr.reimbursements.create(ctx.identity.employee_id, args["category"], args["amount"], date.fromisoformat(args["date"]),
                                     parsed.merchant or up["filename"], parsed.cnpj or "", args.get("description", ""), ctx.today)
    return ToolResult(data={"reimbursement_id": r.id, "status": r.status},
                      summary=f"Reembolso {r.id} de {money(r.amount)} enviado para aprovação.")


@tool("reimbursement_submit", params=SubmitArgs, action="self.reimbursement.request", executor=_execute_submit)
def reimbursement_submit(ctx: ToolContext, args: SubmitArgs) -> ToolResult:
    payload = args.model_dump(mode="json")
    _up, issues = _check(ctx, payload)
    errors = [i for i in issues if i["severity"] == "error"]
    if errors:
        data = {"issues": issues}
        return ToolResult.fail("Não posso enviar: " + " ".join(i["message"] for i in errors), data, Card("validation", data))
    policy = company_policies()["reimbursement"]
    details = [{"label": "Categoria", "value": args.category}, {"label": "Valor", "value": money(args.amount)},
               {"label": "Data", "value": d(args.date)}, {"label": "Aprovação", "value": policy["approval"]},
               {"label": "Pagamento", "value": policy["payment"]}]
    draft = ProposalDraft(summary=f"Pedir reembolso de {money(args.amount)} ({args.category})", details=details, args=payload)
    return ToolResult(data={"valid": True}, summary="O comprovante está dentro da política. Confirme para enviar o pedido.", proposal=draft)


@tool("reimbursement_list", params=NoArgs, action="self.reimbursement.read")
def reimbursement_list(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        items = hr.reimbursements.list(ctx.subject_id)
    rows = [[r.date.isoformat(), r.category, r.amount, r.status] for r in items]
    data = {"title": "Meus reembolsos", "columns": ["Data", "Categoria", "Valor", "Status"], "rows": rows, "money_columns": [2]}
    pending = [r for r in items if r.status in ("em análise", "aprovado")]
    if not items:
        summary = "Você não tem pedidos de reembolso registrados. Envie um comprovante para começar."
    else:
        summary = f"Você tem {len(items)} reembolso(s) registrado(s)"
        summary += f"; {len(pending)} ainda não foram pagos ({money(sum(r.amount for r in pending))})." if pending else ", todos pagos."
    return ToolResult(data=data, summary=summary, card=Card("table", data))


class GuideArgs(Args):
    category: str | None = Field(None, max_length=60, description="Despesa como a pessoa descreveu (ex.: almoço com cliente, hotel da viagem)")


def guide_category(asked: str, policy: dict) -> tuple[str | None, bool]:
    """The policy category for the expense the person described, and whether it is a meal outside
    a trip (which no category covers)."""
    f = fold(asked)
    exact = next((name for name in policy["categories"] if fold(name) in f), None)
    if exact:
        return exact, False
    travel = any(contains_phrase(f, w) for w in policy["travel_words"])
    for name, words in policy["category_words"].items():
        if any(contains_phrase(f, w) for w in words):
            if name == "alimentação em viagem" and not travel:
                return None, True
            return name, False
    return None, False


@tool("reimbursement_guide", params=GuideArgs, action="none")
def reimbursement_guide(ctx: ToolContext, args: GuideArgs) -> ToolResult:
    """Before the receipt: what the policy allows for this expense and how to send it."""
    from atrium.tools.common import knowledge_answer

    policy = company_policies()["reimbursement"]
    match, meal_outside_travel = guide_category(args.category or "", policy)
    categories = [{"name": name, "limit": rule["limit"], "per": rule["per"], "match": name == match}
                  for name, rule in policy["categories"].items()]
    data = {"category": match, "categories": categories, "submit_within_days": policy["submit_within_days"],
            "approval": policy["approval"], "not_reimbursable": policy["not_reimbursable"],
            "requirements": "nota fiscal, cupom fiscal ou recibo legível, com CNPJ, data e valor",
            "accepts": "PDF, PNG, JPG ou TXT, até 5 MB",
            "note": policy["meal_outside_travel"] if meal_outside_travel else None}
    rule = next((c for c in categories if c["match"]), None)
    lead = f"{policy['meal_outside_travel']} " if meal_outside_travel else (
        f"Para {rule['name']}, o limite é {money(rule['limit'])} por {rule['per']}. " if rule else "")
    summary = lead + (f"Envie o comprovante ({data['requirements']}) em até {policy['submit_within_days']} dias da despesa; "
                      f"a aprovação é do {policy['approval']}. Anexe o arquivo aqui na conversa e eu leio os campos para você conferir.")
    _answer, citations, _results = knowledge_answer(ctx, f"reembolso {args.category or 'comprovante despesa'}", list(ctx.knowledge) or ["reembolso"])
    return ToolResult(data=data, summary=summary, card=Card("receipt_upload", data), citations=citations[:2])
