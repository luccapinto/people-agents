"""People Analytics (agent: People Analytics). Aggregates only, with k-anonymity.

Groups with fewer than k people (k >= 5, policy ``k_anonymity_min``) are suppressed. If a
single group would be suppressed, the next smallest group is suppressed too, so the
hidden value cannot be derived from the total (complementary suppression).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from pydantic import Field

from atrium.authz.policy import unit_subtree
from atrium.calculators.holidays import holiday_map, is_non_working
from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, ToolContext, ToolError, ToolResult
from atrium.text import fold
from atrium.tools.vacation import build_states

HRBP = frozenset({"hrbp"})
METRICS = {
    "headcount": ("Headcount", "Pessoas ativas na data de hoje."),
    "turnover": ("Turnover (12 meses)", "Desligamentos nos últimos 12 meses ÷ headcount médio do período."),
    "absenteeism": ("Absenteísmo (2026)", "Dias de ausência ÷ dias úteis previstos de janeiro até o último mês fechado."),
    "vacation_overdue": ("Férias a vencer (90 dias)", "Pessoas com saldo cujo período concessivo termina em até 90 dias."),
    "time_bank": ("Banco de horas médio", "Média do saldo de banco de horas no último mês fechado, em horas."),
}


def _tenure(hire: date, today: date) -> str:
    years = (today - hire).days / 365.25
    return "até 1 ano" if years < 1 else "1 a 3 anos" if years < 3 else "3 a 5 anos" if years < 5 else "mais de 5 anos"


def suppress(groups: list[dict], k: int) -> list[dict]:
    for g in groups:
        g["suppressed"] = g["n"] < k
    hidden = [g for g in groups if g["suppressed"]]
    if len(hidden) == 1:
        visible = sorted((g for g in groups if not g["suppressed"]), key=lambda g: (g["n"], g["group"]))
        if visible:
            visible[0]["suppressed"] = True
            visible[0]["secondary"] = True
    for g in groups:
        if g["suppressed"]:
            g["value"] = None
            g["n"] = None
    return groups


class AnalyticsArgs(Args):
    metric: str = Field(..., description="headcount, turnover, absenteeism, vacation_overdue ou time_bank")
    group_by: str = Field("unit", description="unit (área), tenure (tempo de casa) ou work_mode (modelo de trabalho)")
    unit: str | None = Field(None, description="Unidade (nome ou código); padrão: todo o escopo do HRBP")


@tool("analytics_query", params=AnalyticsArgs, action="analytics.aggregate", roles=HRBP)
def analytics_query(ctx: ToolContext, args: AnalyticsArgs) -> ToolResult:
    if args.metric not in METRICS:
        raise ToolError("Métricas disponíveis: " + ", ".join(METRICS))
    if args.group_by not in ("unit", "tenure", "work_mode"):
        raise ToolError("Agrupe por área (unit), tempo de casa (tenure) ou modelo de trabalho (work_mode).")
    with ctx.hr() as hr:
        units = hr.directory.units()
    by_id = {u.id: u for u in units}
    scope_roots = set(ctx.identity.hrbp_units)
    if args.unit:
        q = fold(args.unit)
        match = next((u for u in units if fold(u.id) == q or fold(u.name) == q), None) or next(
            (u for u in units if q in fold(u.name)), None)
        if match is None:
            raise ToolError(f"Unidade “{args.unit}” não encontrada.")
        scope_roots = {match.id}
    scope = unit_subtree(units, scope_roots)
    decision = ctx.services.policy.authorize(ctx.identity, "analytics.aggregate", unit_ids=sorted(scope), all_units=units)
    if not decision.allowed:
        r = ToolResult.fail(decision.reason)
        r.decision = decision
        return r
    k = ctx.services.policy.k_anonymity()
    today = ctx.today
    with ctx.hr() as hr:
        people = [e for e in hr.directory.by_units(sorted(scope), include_terminated=True) if e.id != ctx.identity.employee_id]
        active_ids = [e.id for e in people if e.status == "active"]
        absences = hr.time.absences_for(active_ids) if args.metric == "absenteeism" else []
        months = hr.time.months_for(active_ids) if args.metric == "time_bank" else []
        periods = hr.vacation.periods_for(active_ids) if args.metric == "vacation_overdue" else []
        requests = hr.vacation.requests_for(active_ids) if args.metric == "vacation_overdue" else []

    def group_of(e) -> str:
        if args.group_by == "tenure":
            return _tenure(e.hire_date, today)
        if args.group_by == "work_mode":
            return e.work_mode
        # direct child of the scope root that contains the person's unit
        u = by_id[e.unit_id]
        chain = [u.id]
        while by_id[chain[-1]].parent_id:
            chain.append(by_id[chain[-1]].parent_id)
        roots = [r for r in scope_roots if r in chain]
        root = roots[0] if roots else chain[-1]
        idx = chain.index(root)
        return by_id[chain[idx - 1]].name if idx > 0 else by_id[root].name

    buckets: dict[str, dict] = defaultdict(lambda: {"active": [], "terminated": []})
    for e in people:
        key = group_of(e)
        if e.status == "active":
            buckets[key]["active"].append(e)
        elif e.termination_date and e.termination_date > today - timedelta(days=365):
            buckets[key]["terminated"].append(e)

    hmap = holiday_map([today.year])
    last_closed = date(today.year, today.month, 1) - timedelta(days=1)
    workdays = sum(1 for i in range((last_closed - date(today.year, 1, 1)).days + 1)
                   if not is_non_working(date(today.year, 1, 1) + timedelta(days=i), hmap))
    groups = []
    for key in sorted(buckets):
        act, term = buckets[key]["active"], buckets[key]["terminated"]
        n = len(act)
        if args.metric == "headcount":
            value = n
        elif args.metric == "turnover":
            avg = n + len(term) / 2
            value = round(100 * len(term) / avg, 1) if avg else 0.0
            n = n + len(term)
        elif args.metric == "absenteeism":
            ids = {e.id for e in act}
            days = sum(a.days for a in absences if a.employee_id in ids)
            value = round(100 * days / (workdays * n), 2) if n else 0.0
        elif args.metric == "vacation_overdue":
            ids = {e.id for e in act}
            value = 0
            for eid in ids:
                rows = build_states([p for p in periods if p.employee_id == eid], [r for r in requests if r.employee_id == eid], today)
                if any(r["status"] == "open" and r["balance_days"] > 0 and r["days_to_deadline"] <= 90 for r in rows):
                    value += 1
        else:
            ids = {e.id for e in act}
            last = {}
            for m in months:
                if m.employee_id in ids:
                    last[m.employee_id] = m.bank_balance_hours
            value = round(sum(last.values()) / len(last), 1) if last else 0.0
        groups.append({"group": key, "value": value, "n": n, "suppressed": False})
    groups = suppress(groups, k)
    label, definition = METRICS[args.metric]
    unit_name = by_id[next(iter(scope_roots))].name if len(scope_roots) == 1 else "escopo do HRBP"
    data = {"metric": args.metric, "label": label, "definition": definition, "group_by": args.group_by, "unit": unit_name,
            "k": k, "groups": groups, "suppressed_count": sum(1 for g in groups if g["suppressed"]),
            "unit_suffix": "%" if args.metric in ("turnover", "absenteeism") else ("h" if args.metric == "time_bank" else "")}
    shown = [g for g in groups if not g["suppressed"]]
    fmt = (lambda v: f"{v:g}%".replace(".", ",")) if data["unit_suffix"] == "%" else (lambda v: f"{v:g}".replace(".", ","))
    summary = f"{label} em {unit_name}: " + "; ".join(f"{g['group']} {fmt(g['value'])}{'h' if args.metric == 'time_bank' else ''}" for g in shown) + "."
    if data["suppressed_count"]:
        summary += f" {data['suppressed_count']} grupo(s) foram suprimidos por terem menos de {k} pessoas (k-anonimato)."
    res = ToolResult(data=data, summary=summary, card=Card("analytics", data))
    res.decision = decision
    return res
