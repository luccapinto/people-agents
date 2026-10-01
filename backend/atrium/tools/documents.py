"""Document tools (agent: Documentos e Declarações). PDFs are rendered by the API."""

from __future__ import annotations

from datetime import date

from pydantic import Field

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, ToolContext, ToolError, ToolResult
from atrium.tools._util import d, money


def _issue(ctx: ToolContext, kind: str, params: dict, title: str) -> dict:
    with ctx.hr() as hr:
        doc = hr.documents.record(ctx.identity.employee_id, kind, params)
    return {"document_id": doc.id, "kind": kind, "title": title, "verification_code": doc.verification_code,
            "issued_on": ctx.today.isoformat(), "pdf_url": f"/api/documents/issued/{doc.id}", "params": params}


class LetterArgs(Args):
    purpose: str = Field("comprovação de vínculo", max_length=120, description="Finalidade (ex.: banco, aluguel)")


@tool("documents_employment_letter", params=LetterArgs, action="self.documents.issue")
def documents_employment_letter(ctx: ToolContext, args: LetterArgs) -> ToolResult:
    data = _issue(ctx, "employment_letter", {"purpose": args.purpose}, "Declaração de vínculo empregatício")
    return ToolResult(data=data, card=Card("document", data),
                      summary=f"Emiti sua declaração de vínculo ({args.purpose}). Código de verificação {data['verification_code']}.")


class VisaArgs(Args):
    country: str = Field(..., max_length=60, description="País de destino")
    start: date = Field(..., description="Início da viagem (AAAA-MM-DD)")
    end: date = Field(..., description="Fim da viagem (AAAA-MM-DD)")


@tool("documents_visa_letter", params=VisaArgs, action="self.documents.issue")
def documents_visa_letter(ctx: ToolContext, args: VisaArgs) -> ToolResult:
    if args.end < args.start:
        raise ToolError("A data de fim da viagem é anterior ao início.")
    data = _issue(ctx, "visa_letter", {"country": args.country, "start": args.start.isoformat(), "end": args.end.isoformat()},
                  f"Carta para visto — {args.country}")
    return ToolResult(data=data, card=Card("document", data),
                      summary=f"Emiti a carta para o consulado ({args.country}, {d(args.start)} a {d(args.end)}), "
                              f"com código de verificação {data['verification_code']}.")


class StatementArgs(Args):
    year: int = Field(2025, description="Ano-calendário")


@tool("documents_income_statement", params=StatementArgs, action="self.documents.issue")
def documents_income_statement(ctx: ToolContext, args: StatementArgs) -> ToolResult:
    with ctx.hr() as hr:
        st = hr.payroll.income_statement(ctx.subject_id, args.year)
    if st is None:
        return ToolResult.fail(f"Não há informe de rendimentos de {args.year} para você.")
    data = _issue(ctx, "income_statement", {"year": args.year}, f"Informe de rendimentos {args.year}")
    data["figures"] = st.model_dump()
    return ToolResult(data=data, card=Card("document", data),
                      summary=(f"Informe de {args.year}: rendimentos tributáveis {money(st.taxable_income)}, INSS {money(st.inss)}, "
                               f"IRRF {money(st.irrf)}, 13º de {money(st.thirteenth_gross)} (tributação exclusiva)."))

