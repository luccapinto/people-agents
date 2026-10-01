"""Time and attendance tools (agent: Ponto e Jornada)."""

from __future__ import annotations

from datetime import date
from datetime import date as Date

from pydantic import Field

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolResult
from atrium.tools._util import MONTHS, company_policies, d


def time_rows(months) -> list[dict]:
    return [{"month": m.month, "label": MONTHS[int(m.month[5:]) - 1][:3], "expected": m.expected_hours, "worked": m.worked_hours,
             "overtime": m.overtime_hours, "bank_delta": m.bank_delta_hours, "bank_balance": m.bank_balance_hours} for m in months]


def _h(v: float) -> str:
    return f"{v:g}h".replace(".", ",")


@tool("time_get_bank", params=NoArgs, action="self.time.read")
def time_get_bank(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        months = hr.time.months(ctx.subject_id)
    if not months:
        return ToolResult.fail("Ainda não há registros de ponto fechados para você.")
    rows = time_rows(months)
    last = rows[-1]
    limit = company_policies()["time"]["bank_hours_limit"]
    data = {"months": rows, "bank_balance": last["bank_balance"], "last_month": last["month"], "overtime_last_month": last["overtime"],
            "overtime_year": sum(r["overtime"] for r in rows), "limit": limit}
    summary = (f"Seu banco de horas está em {_h(last['bank_balance'])} (limite de {limit}h). "
               f"Em {MONTHS[int(last['month'][5:]) - 1]} você fez {_h(last['overtime'])} de horas extras pagas; "
               f"no ano, {_h(data['overtime_year'])}.")
    return ToolResult(data=data, summary=summary, card=Card("time_bank", data))


class AdjustArgs(Args):
    date: Date = Field(..., description="Dia da marcação (AAAA-MM-DD)")
    time: str = Field(..., pattern=r"^\d{2}:\d{2}$", description="Horário HH:MM")
    kind: str = Field(..., description="entrada ou saída")
    reason: str = Field(..., min_length=3, max_length=200, description="Motivo do ajuste")


def _execute_adjust(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        a = hr.time.request_adjustment(ctx.identity.employee_id, date.fromisoformat(args["date"]), args["time"], args["kind"], args["reason"])
    return ToolResult(data={"adjustment_id": a.id}, summary=f"Ajuste {a.id} enviado para aprovação do gestor.")


@tool("time_request_adjustment", params=AdjustArgs, action="self.time.request", executor=_execute_adjust)
def time_request_adjustment(ctx: ToolContext, args: AdjustArgs) -> ToolResult:
    if args.kind not in ("entrada", "saída", "saida"):
        return ToolResult.fail("Informe se o ajuste é de entrada ou de saída.")
    if args.date > ctx.today:
        return ToolResult.fail("Não é possível ajustar marcações futuras.")
    details = [{"label": "Dia", "value": d(args.date)}, {"label": "Marcação", "value": f"{args.kind} às {args.time}"},
               {"label": "Motivo", "value": args.reason}, {"label": "Prazo", "value": company_policies()["time"]["adjustment_deadline"]}]
    draft = ProposalDraft(summary=f"Ajustar ponto de {d(args.date)} ({args.kind} {args.time})", details=details,
                          args=args.model_dump(mode="json") | {"kind": "saída" if args.kind == "saida" else args.kind})
    return ToolResult(data={"valid": True}, summary="Preparei o ajuste de ponto para você confirmar.", proposal=draft)
