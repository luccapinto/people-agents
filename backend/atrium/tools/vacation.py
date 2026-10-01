"""Vacation and leave tools (agent: Férias e Ausências)."""

from __future__ import annotations

from datetime import date, timedelta

from pydantic import Field

from atrium.calculators.holidays import holidays
from atrium.calculators.payroll import vacation_pay
from atrium.calculators.vacation import (
    MIN_FRACTION,
    Fraction,
    PeriodState,
    best_windows,
    plan_balance,
    validate_request,
)
from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolError, ToolResult
from atrium.tools._util import company_policies, current_salary, d, dm, hmap_for, ir_dependents, money, next_working_day, plural

ACTIVE = ("taken", "approved", "pending_manager")


def build_states(periods, requests, today: date) -> list[dict]:
    """Merge periods with requests into balance rows (used by self and manager tools)."""
    rows = []
    for p in periods:
        reqs = [r for r in requests if r.period_id == p.id and r.status in ACTIVE]
        fractions = [Fraction(r.start, r.days) for r in reqs]
        sold = sum(r.sell_days for r in reqs)
        if p.status == "accruing":
            months = 0
            probe = p.acquisition_start
            while True:
                nxt = date(probe.year + (probe.month == 12), probe.month % 12 + 1, min(probe.day, 28))
                if nxt > today:
                    break
                months += 1
                probe = nxt
            entitled = min(30, months * 5 // 2)
        else:
            entitled = p.entitled_days
        state = PeriodState(p.acquisition_start, p.acquisition_end, entitled, fractions, sold)
        taken = sum(r.days for r in reqs if r.status in ("taken", "approved") and r.start + timedelta(days=r.days - 1) < today)
        scheduled = sum(r.days for r in reqs if r.status == "approved" and r.start + timedelta(days=r.days - 1) >= today)
        pending = sum(r.days for r in reqs if r.status == "pending_manager")
        days_left = (p.concession_end - today).days
        balance = state.balance if p.status != "accruing" else 0
        risk = "ok"
        if p.status == "open" and balance > 0:
            risk = "critical" if days_left <= 60 else ("attention" if days_left <= 120 else "ok")
        rows.append({
            "id": p.id, "status": p.status,
            "label": f"{p.acquisition_start.year}/{p.acquisition_end.year}",
            "acquisition_start": p.acquisition_start.isoformat(), "acquisition_end": p.acquisition_end.isoformat(),
            "concession_end": p.concession_end.isoformat(), "entitled_days": entitled, "taken_days": taken,
            "scheduled_days": scheduled, "pending_days": pending, "sold_days": sold, "balance_days": balance,
            "days_to_deadline": days_left, "risk": risk, "fractions_used": len(fractions),
            "has_main_fraction": state.has_main_fraction,
        })
    return rows


def _usable(rows: list[dict]) -> dict | None:
    open_rows = [r for r in rows if r["status"] == "open" and r["balance_days"] >= MIN_FRACTION]
    return min(open_rows, key=lambda r: r["concession_end"]) if open_rows else None


def _state_for(row: dict, requests) -> PeriodState:
    fractions = [Fraction(r.start, r.days) for r in requests if r.period_id == row["id"] and r.status in ACTIVE]
    return PeriodState(date.fromisoformat(row["acquisition_start"]), date.fromisoformat(row["acquisition_end"]),
                       row["entitled_days"], fractions, row["sold_days"])


def last_vacation_end(requests, today: date) -> date | None:
    ends = [r.start + timedelta(days=r.days - 1) for r in requests if r.status in ("taken", "approved") and r.start <= today]
    return max(ends) if ends else None


# --------------------------------------------------------------------------- balance
@tool("vacation_get_balance", params=NoArgs, action="self.vacation.read")
def vacation_get_balance(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        periods = hr.vacation.periods(ctx.subject_id)
        requests = hr.vacation.requests(ctx.subject_id)
    rows = build_states(periods, requests, ctx.today)
    visible = [r for r in rows if r["status"] in ("open", "accruing")]
    available = sum(r["balance_days"] for r in visible)
    accruing = next((r for r in visible if r["status"] == "accruing"), None)
    usable = _usable(rows)
    data = {"available_days": available, "periods": visible,
            "accruing_days": accruing["entitled_days"] if accruing else 0,
            "next_deadline": usable["concession_end"] if usable else None}
    if usable:
        dl = date.fromisoformat(usable["concession_end"])
        summary = (f"Você tem {plural(available, 'dia', 'dias')} de férias disponíveis. "
                   f"O período {usable['label']} precisa ser usado até {d(dl)} (faltam {usable['days_to_deadline']} dias); "
                   f"depois disso os dias seriam pagos em dobro.")
    else:
        summary = "Você não tem saldo de férias disponível agora."
    if accruing:
        summary += f" No período em aquisição você já acumulou {plural(accruing['entitled_days'], 'dia', 'dias')}."
    return ToolResult(data=data, summary=summary, card=Card("vacation_balance", data))


# --------------------------------------------------------------------------- holidays
class CalendarArgs(Args):
    year: int | None = Field(None, description="Ano (padrão: ano atual)")


@tool("vacation_holiday_calendar", params=CalendarArgs, action="none")
def vacation_holiday_calendar(ctx: ToolContext, args: CalendarArgs) -> ToolResult:
    year = args.year or ctx.today.year
    if not 2024 <= year <= 2030:
        raise ToolError("Tenho o calendário de 2024 a 2030.")
    items = [h.as_dict() | {"weekday": h.date.weekday()} for h in holidays(year, ctx.identity.location)]
    weekdays = [h for h in items if h["weekday"] < 5]
    summary = (f"Em {year} a sede (São Paulo) tem {len(items)} feriados e pontos facultativos, "
               f"{len(weekdays)} deles em dias úteis.")
    data = {"year": year, "location": "São Paulo, SP", "holidays": items}
    return ToolResult(data=data, summary=summary, card=Card("holiday_calendar", data))


# --------------------------------------------------------------------------- suggestions
class SuggestArgs(Args):
    days: int | None = Field(None, ge=5, le=30, description="Quantidade de dias de férias desejada (opcional)")


@tool("vacation_suggest_windows", params=SuggestArgs, action="self.vacation.read")
def vacation_suggest_windows(ctx: ToolContext, args: SuggestArgs) -> ToolResult:
    with ctx.hr() as hr:
        periods = hr.vacation.periods(ctx.subject_id)
        requests = hr.vacation.requests(ctx.subject_id)
    rows = build_states(periods, requests, ctx.today)
    usable = _usable(rows)
    if usable is None:
        accruing = next((r for r in rows if r["status"] == "accruing"), None)
        when = d(date.fromisoformat(accruing["acquisition_end"]) + timedelta(days=1)) if accruing else "em breve"
        return ToolResult.fail(f"Você ainda não tem saldo para tirar férias; o próximo período fica disponível em {when}.")
    hmap = hmap_for(ctx.today)
    state = _state_for(usable, requests)
    earliest = ctx.today + timedelta(days=company_policies()["vacation"]["notice_days"])
    latest = min(state.deadline, ctx.today + timedelta(days=365))
    balance = usable["balance_days"]
    if args.days and args.days > balance:
        raise ToolError(f"Você tem {balance} dias disponíveis neste período; não dá para tirar {args.days}.")
    lengths = [args.days] if args.days else sorted({n for n in (5, 7, 10, 14, 15, balance) if MIN_FRACTION <= n <= balance})
    windows = best_windows(lengths, hmap, earliest, latest, state.fractions, top=5)
    plans = [] if args.days else plan_balance(state, hmap, earliest, latest)
    hol = [h.as_dict() for y in range(earliest.year, latest.year + 1) for h in holidays(y, ctx.identity.location)
           if earliest <= h.date <= latest]
    data = {
        "period": usable["label"], "balance_days": balance, "deadline": state.deadline.isoformat(),
        "earliest_start": earliest.isoformat(), "latest_end": latest.isoformat(),
        "windows": [w.as_dict() for w in windows], "plans": [p.as_dict() for p in plans], "holidays": hol,
    }
    if not windows:
        return ToolResult.fail("Não encontrei janelas válidas antes do fim do período concessivo.", data)
    best = windows[0]
    summary = (f"A janela mais eficiente é de {dm(best.start)} a {dm(best.end)}: {plural(best.days, 'dia', 'dias')} de saldo "
               f"rendem {best.rest_days} dias corridos de descanso")
    summary += f", emendando {', '.join(best.holidays_bridged)}." if best.holidays_bridged else "."
    if plans:
        p = plans[0]
        parts = " + ".join(f"{w.days} dias a partir de {dm(w.start)}" for w in sorted(p.windows, key=lambda w: w.start))
        summary += (f" Para usar todos os {balance} dias até {d(state.deadline)}, o melhor plano é {parts}, "
                    f"totalizando {p.rest_days} dias de descanso.")
    return ToolResult(data=data, summary=summary, card=Card("vacation_calendar", data))


# --------------------------------------------------------------------------- simulation
class SimulateArgs(Args):
    days: int = Field(..., ge=5, le=30, description="Dias de férias a tirar")
    sell_days: int = Field(0, ge=0, le=10, description="Dias a vender (abono pecuniário)")
    advance_13th: bool = Field(False, description="Adiantar a 1ª parcela do 13º")


def _pay(ctx: ToolContext, days: int, sell: int, adv: bool):
    with ctx.hr() as hr:
        salary = current_salary(hr.payroll.salary_history(ctx.identity.employee_id))
        deps = ir_dependents(hr.benefits.dependents(ctx.identity.employee_id))
    return salary, vacation_pay(salary, days, sell, adv, deps, ctx.today)


@tool("vacation_simulate", params=SimulateArgs, action="self.vacation.read")
def vacation_simulate(ctx: ToolContext, args: SimulateArgs) -> ToolResult:
    salary, r = _pay(ctx, args.days, args.sell_days, args.advance_13th)
    lines = [{"label": ln["label"], "value": ln.get("earning", ln.get("deduction")),
              "kind": "earning" if "earning" in ln else "deduction"} for ln in r.lines]
    data = {"title": f"Simulação de férias ({args.days} dias)", "salary": float(salary), "lines": lines,
            "gross": float(r.gross_total), "deductions": float(r.inss + r.irrf), "net": float(r.net_total),
            "notes": ["Abono pecuniário e seu 1/3 não têm INSS nem IRRF.",
                      "O pagamento ocorre até 2 dias antes do início das férias (CLT art. 145).",
                      "Simulação com as tabelas oficiais de 2026; a folha pode ajustar o INSS no fechamento do mês."]}
    summary = (f"Com {args.days} dias de férias" + (f" e {args.sell_days} dias vendidos" if args.sell_days else "") +
               f", o valor bruto estimado é {money(r.gross_total)} e o líquido {money(r.net_total)} "
               f"(INSS {money(r.inss)}, IRRF {money(r.irrf)}).")
    return ToolResult(data=data, summary=summary, card=Card("breakdown", data))


# --------------------------------------------------------------------------- request
class RequestArgs(Args):
    start: date = Field(..., description="Data de início (AAAA-MM-DD)")
    days: int = Field(..., ge=5, le=30, description="Dias corridos de férias")
    sell_days: int = Field(0, ge=0, le=10, description="Dias a vender (abono)")
    advance_13th: bool = Field(False, description="Adiantar 1ª parcela do 13º")


def _validate(ctx: ToolContext, start: date, days: int, sell: int):
    with ctx.hr() as hr:
        periods = hr.vacation.periods(ctx.identity.employee_id)
        requests = hr.vacation.requests(ctx.identity.employee_id)
    rows = build_states(periods, requests, ctx.today)
    usable = _usable(rows)
    if usable is None:
        raise ToolError("Você não tem saldo de férias disponível para solicitar agora.")
    state = _state_for(usable, requests)
    issues = validate_request(state, start, days, sell, hmap_for(ctx.today), ctx.today)
    return usable, state, issues


def _execute_request(ctx: ToolContext, args: dict) -> ToolResult:
    start = date.fromisoformat(args["start"])
    usable, _state, issues = _validate(ctx, start, args["days"], args["sell_days"])
    errors = [i for i in issues if i.severity == "error"]
    if errors:
        raise ToolError(errors[0].message)
    with ctx.hr() as hr:
        req = hr.vacation.create_request(ctx.identity.employee_id, usable["id"], start, args["days"], args["sell_days"],
                                         args["advance_13th"], ctx.today)
        manager = hr.directory.get(ctx.identity.manager_id) if ctx.identity.manager_id else None
    who = manager.name if manager else "sua liderança"
    return ToolResult(data={"request_id": req.id, "status": req.status},
                      summary=f"Pedido {req.id} registrado e enviado para aprovação de {who}.")


@tool("vacation_request", params=RequestArgs, action="self.vacation.request", executor=_execute_request)
def vacation_request(ctx: ToolContext, args: RequestArgs) -> ToolResult:
    usable, state, issues = _validate(ctx, args.start, args.days, args.sell_days)
    errors = [i for i in issues if i.severity == "error"]
    if errors:
        data = {"issues": [i.as_dict() for i in issues], "start": args.start.isoformat(), "days": args.days}
        return ToolResult.fail("Não dá para pedir essas datas: " + " ".join(i.message for i in errors),
                               data, Card("validation", data))
    end = args.start + timedelta(days=args.days - 1)
    back = next_working_day(end, hmap_for(ctx.today))
    _salary, pay = _pay(ctx, args.days, args.sell_days, args.advance_13th)
    details = [
        {"label": "Período de férias", "value": f"{d(args.start)} a {d(end)} ({args.days} dias corridos)"},
        {"label": "Retorno", "value": d(back)},
        {"label": "Período aquisitivo", "value": usable["label"]},
        {"label": "Saldo após o pedido", "value": plural(usable["balance_days"] - args.days - args.sell_days, "dia", "dias")},
        {"label": "Valor líquido estimado", "value": money(pay.net_total)},
    ]
    if args.sell_days:
        details.insert(1, {"label": "Abono pecuniário", "value": plural(args.sell_days, "dia vendido", "dias vendidos")})
    for i in issues:
        details.append({"label": "Atenção", "value": i.message})
    draft = ProposalDraft(summary=f"Solicitar férias de {d(args.start)} a {d(end)}",
                          details=details, args=args.model_dump(mode="json"))
    return ToolResult(data={"valid": True, "end": end.isoformat(), "return": back.isoformat()},
                      summary=f"As datas são válidas. Preparei o pedido de {d(args.start)} a {d(end)} para você confirmar.",
                      proposal=draft)


@tool("vacation_list_requests", params=NoArgs, action="self.vacation.read")
def vacation_list_requests(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        reqs = hr.vacation.requests(ctx.subject_id)
    labels = {"pending_manager": "aguardando gestor", "approved": "aprovado", "taken": "gozado", "rejected": "recusado", "cancelled": "cancelado"}
    recent = [r for r in reqs if r.start >= ctx.today - timedelta(days=400)]
    rows = [{"id": r.id, "start": r.start.isoformat(), "end": (r.start + timedelta(days=r.days - 1)).isoformat(), "days": r.days,
             "sell_days": r.sell_days, "status": r.status, "status_label": labels.get(r.status, r.status)} for r in recent]
    pending = [r for r in rows if r["status"] == "pending_manager"]
    summary = f"Você tem {plural(len(rows), 'pedido', 'pedidos')} no último ano"
    summary += f", {plural(len(pending), 'aguardando', 'aguardando')} aprovação." if pending else "."
    data = {"title": "Meus pedidos de férias", "columns": ["Início", "Fim", "Dias", "Status"],
            "rows": [[r["start"], r["end"], r["days"], r["status_label"]] for r in rows], "requests": rows}
    return ToolResult(data=data, summary=summary, card=Card("table", data))


class CancelArgs(Args):
    request_id: str = Field(..., description="Identificador do pedido (ex.: FER-50001)")


def _execute_cancel(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        req = hr.vacation.get_request(args["request_id"])
        if req is None or req.employee_id != ctx.identity.employee_id:
            raise ToolError("Pedido não encontrado.")
        hr.vacation.set_status(req.id, "cancelled", None, "cancelado pela pessoa")
    return ToolResult(data={"request_id": req.id, "status": "cancelled"}, summary=f"Pedido {req.id} cancelado.")


@tool("vacation_cancel_request", params=CancelArgs, action="self.vacation.request", executor=_execute_cancel)
def vacation_cancel_request(ctx: ToolContext, args: CancelArgs) -> ToolResult:
    with ctx.hr() as hr:
        req = hr.vacation.get_request(args.request_id)
    if req is None or req.employee_id != ctx.identity.employee_id:
        return ToolResult.fail("Não encontrei esse pedido entre os seus.")
    if req.status not in ("pending_manager", "approved") or req.start <= ctx.today:
        return ToolResult.fail("Só é possível cancelar pedidos pendentes ou aprovados que ainda não começaram.")
    end = req.start + timedelta(days=req.days - 1)
    draft = ProposalDraft(summary=f"Cancelar férias de {d(req.start)} a {d(end)}",
                          details=[{"label": "Pedido", "value": req.id}, {"label": "Dias devolvidos ao saldo", "value": str(req.days)}],
                          args={"request_id": req.id})
    return ToolResult(data={"request_id": req.id}, summary="Preparei o cancelamento para você confirmar.", proposal=draft)


# --------------------------------------------------------------------------- leave
class LeaveArgs(Args):
    kind: str = Field(..., description="parental, paternidade, maternidade, casamento, luto ou adocao")
    start: date = Field(..., description="Data de início (AAAA-MM-DD)")


def _leave_days(ctx: ToolContext, kind: str) -> tuple[str, int]:
    leave = company_policies()["leave"]
    if kind in ("parental", "adocao"):
        with ctx.hr() as hr:
            private = hr.directory.private(ctx.identity.employee_id)
        if private and private.sex == "F":
            return "licença-maternidade", leave["maternity_days"]
        return "licença-paternidade", leave["paternity_days"]
    table = {"paternidade": ("licença-paternidade", leave["paternity_days"]),
             "maternidade": ("licença-maternidade", leave["maternity_days"]),
             "casamento": ("licença casamento (gala)", leave["marriage_days"]),
             "luto": ("licença nojo (luto)", leave["bereavement_days"])}
    if kind not in table:
        raise ToolError("Tipo de licença desconhecido.")
    return table[kind]


def _execute_leave(ctx: ToolContext, args: dict) -> ToolResult:
    label, days = _leave_days(ctx, args["kind"])
    start = date.fromisoformat(args["start"])
    with ctx.hr() as hr:
        leave = hr.vacation.create_leave(ctx.identity.employee_id, label, start, days, "registrada pelo assistente")
    return ToolResult(data={"leave_id": leave.id}, summary=f"{label.capitalize()} registrada ({leave.id}). O DP vai pedir a certidão.")


@tool("leave_register", params=LeaveArgs, action="self.leave.request", executor=_execute_leave)
def leave_register(ctx: ToolContext, args: LeaveArgs) -> ToolResult:
    label, days = _leave_days(ctx, args.kind)
    end = args.start + timedelta(days=days - 1)
    leave = company_policies()["leave"]
    details = [{"label": "Licença", "value": label}, {"label": "Período", "value": f"{d(args.start)} a {d(end)} ({days} dias corridos)"},
               {"label": "Documento", "value": leave["documents"]}]
    if "paternidade" in label:
        details.append({"label": "Base", "value": "5 dias legais (2026) + 15 do Programa Empresa Cidadã"})
    data = {"kind": label, "start": args.start.isoformat(), "end": end.isoformat(), "days": days}
    draft = ProposalDraft(summary=f"Registrar {label} a partir de {d(args.start)}", details=details,
                          args={"kind": args.kind, "start": args.start.isoformat()})
    return ToolResult(data=data, summary=f"Você tem direito a {days} dias de {label}, de {d(args.start)} a {d(end)}.",
                      card=Card("leave", data), proposal=draft)
