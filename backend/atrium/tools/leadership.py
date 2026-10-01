"""Manager tools (agent: Liderança). Every team read is authorized per person by the policy
engine; compensation stays hidden unless governance enables it."""

from __future__ import annotations

from datetime import date, timedelta

from pydantic import Field

from atrium.authz.policy import Decision
from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolResult
from atrium.tools._util import d, money, plural
from atrium.tools.vacation import build_states, last_vacation_end

MANAGER = frozenset({"manager"})


def _anniversary(hire: date, today: date) -> date:
    try:
        nxt = hire.replace(year=today.year)
    except ValueError:
        nxt = hire.replace(year=today.year, day=28)
    return nxt if nxt >= today else nxt.replace(year=today.year + 1)


def team_rows(ctx: ToolContext) -> list[dict]:
    me = ctx.identity
    with ctx.hr() as hr:
        team = [e for e in hr.directory.reports(me.employee_id)
                if ctx.services.policy.authorize(me, "team.vacation.read", e.id).allowed]
        ids = [e.id for e in team]
        periods = hr.vacation.periods_for(ids)
        requests = hr.vacation.requests_for(ids)
        months = hr.time.months_for(ids)
        trainings = hr.career.assignments_for(ids)
    rows = []
    for e in team:
        reqs = [r for r in requests if r.employee_id == e.id]
        states = build_states([p for p in periods if p.employee_id == e.id], reqs, ctx.today)
        open_rows = [s for s in states if s["status"] == "open" and s["balance_days"] > 0]
        nearest = min(open_rows, key=lambda s: s["concession_end"]) if open_rows else None
        last = last_vacation_end(reqs, ctx.today)
        since = (ctx.today - (last or e.hire_date)).days
        tm = [m for m in months if m.employee_id == e.id]
        anniv = _anniversary(e.hire_date, ctx.today)
        years = (anniv.year - e.hire_date.year)
        rows.append({
            "id": e.id, "name": e.name, "title": e.title, "hire_date": e.hire_date.isoformat(),
            "tenure_months": (ctx.today.year - e.hire_date.year) * 12 + ctx.today.month - e.hire_date.month,
            "new_member": (ctx.today - e.hire_date).days <= 90,
            "work_anniversary": anniv.isoformat() if (anniv - ctx.today).days <= 30 and years > 0 else None,
            "anniversary_years": years,
            "vacation_balance": sum(s["balance_days"] for s in open_rows),
            "vacation_deadline": nearest["concession_end"] if nearest else None,
            "vacation_risk": nearest["risk"] if nearest else "ok",
            "days_to_deadline": nearest["days_to_deadline"] if nearest else None,
            "days_since_vacation": since if (ctx.today - e.hire_date).days > 365 else None,
            "pending_requests": sum(1 for r in reqs if r.status == "pending_manager"),
            "bank_hours": tm[-1].bank_balance_hours if tm else 0.0,
            "overtime_last_month": tm[-1].overtime_hours if tm else 0.0,
            "mandatory_pending": sum(1 for t in trainings if t.employee_id == e.id and t.status == "pendente"),
        })
    return rows


@tool("team_overview", params=NoArgs, action="team.vacation.read", roles=MANAGER)
def team_overview(ctx: ToolContext, args: NoArgs) -> ToolResult:
    rows = team_rows(ctx)
    expiring = [r for r in rows if r["vacation_risk"] in ("critical", "attention")]
    long_gap = [r for r in rows if (r["days_since_vacation"] or 0) > 365]
    heavy = [r for r in rows if r["overtime_last_month"] >= 12 or r["bank_hours"] >= 30]
    pending = sum(r["pending_requests"] for r in rows)
    anniversaries = [r for r in rows if r["work_anniversary"]]
    data = {"members": rows, "highlights": {
        "expiring": [r["name"] for r in expiring], "long_without_vacation": [r["name"] for r in long_gap],
        "high_hours": [r["name"] for r in heavy], "pending_approvals": pending,
        "anniversaries": [r["name"] for r in anniversaries], "new_members": [r["name"] for r in rows if r["new_member"]]},
        "privacy_note": "Remuneração do time não é exibida pela política de governança vigente."}
    parts = [f"Seu time tem {plural(len(rows), 'pessoa', 'pessoas')}."]
    if expiring:
        parts.append("Férias a vencer: " + ", ".join(f"{r['name']} ({r['vacation_balance']} dias até {d(date.fromisoformat(r['vacation_deadline']))})" for r in expiring) + ".")
    if long_gap:
        parts.append("Há mais de um ano sem férias: " + ", ".join(f"{r['name']} ({r['days_since_vacation']} dias)" for r in long_gap) + ".")
    if heavy:
        parts.append("Carga de horas alta: " + ", ".join(f"{r['name']} ({r['overtime_last_month']:g}h extras, banco {r['bank_hours']:g}h)" for r in heavy) + ".")
    if pending:
        parts.append(f"Você tem {plural(pending, 'pedido de férias aguardando', 'pedidos de férias aguardando')} sua aprovação.")
    if anniversaries:
        parts.append("Aniversário de empresa nos próximos 30 dias: " + ", ".join(f"{r['name']} ({r['anniversary_years']} anos)" for r in anniversaries) + ".")
    return ToolResult(data=data, summary=" ".join(parts), card=Card("team_table", data))


@tool("team_pending_approvals", params=NoArgs, action="team.vacation.read", roles=MANAGER)
def team_pending_approvals(ctx: ToolContext, args: NoArgs) -> ToolResult:
    me = ctx.identity
    with ctx.hr() as hr:
        team = {e.id: e for e in hr.directory.reports(me.employee_id)}
        reqs = [r for r in hr.vacation.requests_for(list(team)) if r.status == "pending_manager"]
    items = [{"request_id": r.id, "employee": team[r.employee_id].name, "employee_id": r.employee_id,
              "start": r.start.isoformat(), "end": (r.start + timedelta(days=r.days - 1)).isoformat(), "days": r.days,
              "sell_days": r.sell_days, "requested_at": r.requested_at.isoformat()} for r in reqs]
    data = {"items": items}
    if not items:
        return ToolResult(data=data, summary="Não há pedidos de férias aguardando sua aprovação.", card=Card("approvals", data))
    summary = "Pedidos aguardando você: " + "; ".join(
        f"{i['employee']}, {d(date.fromisoformat(i['start']))} a {d(date.fromisoformat(i['end']))} ({i['days']} dias, {i['request_id']})" for i in items) + "."
    return ToolResult(data=data, summary=summary, card=Card("approvals", data))


class DecideArgs(Args):
    request_id: str | None = Field(None, description="Pedido de férias (ex.: FER-00123); ou informe a pessoa")
    colleague: str | None = Field(None, max_length=80, description="Nome da pessoa do time cujo pedido pendente será decidido")
    decision: str = Field(..., description="approve (aprovar) ou reject (recusar)")
    note: str = Field("", max_length=200, description="Comentário opcional")


def _execute_decide(ctx: ToolContext, args: dict) -> ToolResult:
    with ctx.hr() as hr:
        req = hr.vacation.get_request(args["request_id"])
        if req is None or req.status != "pending_manager":
            raise PermissionError("Pedido não está mais pendente.")
        status = "approved" if args["decision"] == "approve" else "rejected"
        hr.vacation.set_status(req.id, status, ctx.identity.employee_id, args.get("note") or None)
        who = hr.directory.get(req.employee_id)
    verb = "aprovado" if status == "approved" else "recusado"
    return ToolResult(data={"request_id": req.id, "status": status}, summary=f"Pedido {req.id} de {who.name if who else ''} {verb}.")


@tool("team_decide_vacation", params=DecideArgs, action="team.vacation.decide", roles=MANAGER, executor=_execute_decide)
def team_decide_vacation(ctx: ToolContext, args: DecideArgs) -> ToolResult:
    if args.decision not in ("approve", "reject"):
        return ToolResult.fail("Decisão deve ser aprovar (approve) ou recusar (reject).")
    verb = "Aprovar" if args.decision == "approve" else "Recusar"
    if not args.request_id:
        people, pending = _decide_candidates(ctx, args.colleague) if args.colleague else ([], {})
        if not people:
            return ToolResult.fail("Não encontrei essa pessoa entre os seus liderados diretos.",
                                   suggestions=["Tem pedido de férias esperando eu aprovar?", "Como está o meu time?"])
        if len(people) > 1:  # a first name two of the direct reports share: ask, never pick one
            return ToolResult.fail(f"Há {len(people)} pessoas com esse nome no seu time. De quem é o pedido?",
                                   suggestions=[f"{verb} as férias de {p.name}" for p in people[:3]])
        person = people[0]
        if not pending[person.id]:
            waiting = _waiting_names(ctx)
            others = f" Aguardando a sua decisão: {', '.join(waiting)}." if waiting else ""
            chips = [f"{verb} as férias de {n}" for n in waiting[:2]] or [f"Quanto de férias {person.name.split()[0]} tem?"]
            return ToolResult.fail(f"{person.name} não tem pedido de férias aguardando a sua decisão.{others}",
                                   suggestions=["Tem pedido de férias esperando eu aprovar?", *chips])
        if len(pending[person.id]) > 1:
            return ToolResult.fail(f"{person.name} tem {len(pending[person.id])} pedidos aguardando: qual deles?",
                                   suggestions=[f"{verb} o pedido {r.id}" for r in pending[person.id][:3]])
        args = args.model_copy(update={"request_id": pending[person.id][0].id})
    with ctx.hr() as hr:
        req = hr.vacation.get_request(args.request_id)
        who = hr.directory.get(req.employee_id) if req else None
    if req is None:
        return ToolResult.fail("Pedido não encontrado entre os do seu time.")
    ctx.subject_id = req.employee_id
    decision = ctx.services.policy.authorize(ctx.identity, "team.vacation.decide", req.employee_id)
    if not decision.allowed:
        r = ToolResult.fail(decision.reason)
        r.decision = decision
        return r
    if req.status != "pending_manager":
        return ToolResult.fail("Este pedido não está aguardando decisão.")
    end = req.start + timedelta(days=req.days - 1)
    draft = ProposalDraft(summary=f"{verb} férias de {who.name} ({d(req.start)} a {d(end)})",
                          details=[{"label": "Pessoa", "value": who.name}, {"label": "Período", "value": f"{d(req.start)} a {d(end)} ({req.days} dias)"},
                                   {"label": "Comentário", "value": args.note or "-"}],
                          args=args.model_dump(mode="json"), subject_id=req.employee_id)
    res = ToolResult(data={"request_id": req.id}, summary=f"Preparei a decisão para você confirmar: {verb.lower()} o pedido de {who.name}.",
                     proposal=draft)
    res.decision = decision
    return res


class ColleagueArgs(Args):
    colleague: str = Field(..., description="Nome da pessoa do time")


def resolve_colleague(ctx: ToolContext, name: str):
    """Resolve a typed name to a directory entry, preferring people in the caller's chain."""
    with ctx.hr() as hr:
        hits = hr.directory.search(name, limit=10)
    in_chain = [e for e in hits if e.id in ctx.identity.chain_reports]
    return (in_chain or hits or [None])[0]


def _decide_candidates(ctx: ToolContext, name: str) -> tuple[list, dict[str, list]]:
    """Direct reports matching a typed name, those with a request awaiting the caller first, and
    each one's pending requests. Several left means the name is ambiguous: the caller chooses."""
    with ctx.hr() as hr:
        hits = [e for e in hr.directory.search(name, limit=10) if e.id in ctx.identity.direct_reports]
        pending = {e.id: [r for r in hr.vacation.requests(e.id) if r.status == "pending_manager"] for e in hits}
    waiting = [e for e in hits if pending[e.id]]
    return waiting or hits, pending


def _waiting_names(ctx: ToolContext) -> list[str]:
    """Direct reports with a request awaiting the caller, in the order of their requests."""
    with ctx.hr() as hr:
        reqs = sorted((r for r in hr.vacation.requests_for(sorted(ctx.identity.direct_reports)) if r.status == "pending_manager"),
                      key=lambda r: (r.start, r.id))
        names = [hr.directory.get(r.employee_id).name for r in reqs]
    return list(dict.fromkeys(names))


def _denied(ctx: ToolContext, decision: Decision) -> ToolResult:
    r = ToolResult.fail(decision.reason)
    r.decision = decision
    return r


@tool("team_member_vacation", params=ColleagueArgs, action="team.vacation.read", roles=MANAGER)
def team_member_vacation(ctx: ToolContext, args: ColleagueArgs) -> ToolResult:
    person = resolve_colleague(ctx, args.colleague)
    if person is None:
        return ToolResult.fail(f"Não encontrei “{args.colleague}” no diretório.")
    ctx.subject_id = person.id
    decision = ctx.services.policy.authorize(ctx.identity, "team.vacation.read", person.id)
    if not decision.allowed:
        return _denied(ctx, decision)
    with ctx.hr() as hr:
        periods = hr.vacation.periods(person.id)
        reqs = hr.vacation.requests(person.id)
    rows = [r for r in build_states(periods, reqs, ctx.today) if r["status"] in ("open", "accruing")]
    available = sum(r["balance_days"] for r in rows)
    data = {"person": person.name, "available_days": available, "periods": rows,
            "accruing_days": next((r["entitled_days"] for r in rows if r["status"] == "accruing"), 0), "next_deadline": None}
    open_rows = [r for r in rows if r["status"] == "open" and r["balance_days"] > 0]
    summary = f"{person.name} tem {plural(available, 'dia', 'dias')} de férias disponíveis"
    if open_rows:
        nearest = min(open_rows, key=lambda r: r["concession_end"])
        data["next_deadline"] = nearest["concession_end"]
        summary += f", com prazo até {d(date.fromisoformat(nearest['concession_end']))}"
    res = ToolResult(data=data, summary=summary + ".", card=Card("vacation_balance", data))
    res.decision = decision
    return res


@tool("team_member_compensation", params=ColleagueArgs, action="team.compensation.read", roles=MANAGER)
def team_member_compensation(ctx: ToolContext, args: ColleagueArgs) -> ToolResult:
    person = resolve_colleague(ctx, args.colleague)
    if person is None:
        return ToolResult.fail(f"Não encontrei “{args.colleague}” no diretório.")
    ctx.subject_id = person.id
    decision = ctx.services.policy.authorize(ctx.identity, "team.compensation.read", person.id)
    if not decision.allowed:
        return _denied(ctx, decision)
    with ctx.hr() as hr:
        history = hr.payroll.salary_history(person.id)
    if not history:
        return ToolResult.fail("Sem dados de remuneração visíveis.")
    res = ToolResult(data={"person": person.name, "salary": history[-1].salary},
                     summary=f"O salário atual de {person.name} é {money(history[-1].salary)} (política de governança permite).")
    res.decision = decision
    return res
