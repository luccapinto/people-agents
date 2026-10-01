"""Tools shared by agents: knowledge search, human hand-off, compliance channels."""

from __future__ import annotations

from pydantic import Field
from sqlalchemy import text

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, Citation, NoArgs, ProposalDraft, ToolContext, ToolResult
from atrium.tools._util import company_policies


class SearchArgs(Args):
    query: str = Field(..., min_length=2, max_length=300, description="O que procurar, em linguagem natural")


@tool("kb_search", params=SearchArgs, action="none")
def kb_search(ctx: ToolContext, args: SearchArgs) -> ToolResult:
    kb_ids = list(ctx.knowledge) or ["corporativo"]
    hits = ctx.services.kb.search(ctx.identity, args.query, kb_ids, limit=4)
    if not hits:
        return ToolResult.fail("Não encontrei nada sobre isso nas bases de conhecimento.", {"query": args.query, "kb": kb_ids})
    citations = [Citation(id=h.chunk_id, kb=h.kb_id, document=h.document, section=h.section, snippet=h.snippet, source=h.source)
                 for h in hits]
    data = {"query": args.query, "results": [h.for_model() for h in hits]}
    best = hits[0]
    summary = f"Segundo “{best.document}” ({best.section}): {best.snippet}"
    return ToolResult(data=data, summary=summary, citations=citations)


class TicketArgs(Args):
    category: str = Field(..., max_length=60, description="Área responsável (ex.: Benefícios, DP, TI)")
    summary: str = Field(..., min_length=5, max_length=400, description="Resumo do pedido")


def _execute_ticket(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.services.db.scoped(ctx.identity.employee_id) as c:
        tid = c.execute(text("SELECT 'CH-' || nextval('app.ticket_seq')")).scalar_one()
        c.execute(text("""INSERT INTO app.tickets (id, employee_id, agent_id, category, summary, sensitive)
                          VALUES (:id, :e, :a, :c, :s, :sens)"""),
                  {"id": tid, "e": ctx.identity.employee_id, "a": ctx.agent_id, "c": args["category"], "s": args["summary"],
                   "sens": ctx.agent_id == "compliance"})
    return ToolResult(data={"ticket_id": tid}, summary=f"Chamado {tid} aberto para {args['category']}. Você será contatado por e-mail.")


@tool("ticket_open", params=TicketArgs, action="self.ticket.open", executor=_execute_ticket)
def ticket_open(ctx: ToolContext, args: TicketArgs) -> ToolResult:
    draft = ProposalDraft(summary=f"Abrir chamado para {args.category}",
                          details=[{"label": "Área", "value": args.category}, {"label": "Resumo", "value": args.summary},
                                   {"label": "Prazo de resposta", "value": "até 2 dias úteis"}],
                          args=args.model_dump(mode="json"))
    return ToolResult(data={"category": args.category}, summary="Posso abrir um chamado para o time humano. Confirme no cartão.",
                      proposal=draft)


@tool("compliance_support_channels", params=NoArgs, action="none")
def compliance_support_channels(ctx: ToolContext, args: NoArgs) -> ToolResult:
    c = company_policies()["compliance"]
    data = {"channels": [
        {"kind": "ethics", "name": c["ethics_channel"]["name"], "url": c["ethics_channel"]["url"], "phone": c["ethics_channel"]["phone"],
         "description": "Relatos de assédio, discriminação, fraude ou conduta antiética. Pode ser anônimo; a empresa proíbe retaliação."},
        {"kind": "support", "name": c["support_program"]["name"], "phone": c["support_program"]["phone"],
         "description": c["support_program"]["description"]},
        {"kind": "emergency", "name": "Emergência", "description": c["emergency"]}]}
    summary = (f"Você pode procurar o {c['ethics_channel']['name']} ({c['ethics_channel']['url']}, {c['ethics_channel']['phone']}), "
               f"inclusive de forma anônima, e o {c['support_program']['name']} ({c['support_program']['phone']}), "
               f"{c['support_program']['description']}. {c['emergency']}")
    return ToolResult(data=data, summary=summary, card=Card("support_channels", data))
