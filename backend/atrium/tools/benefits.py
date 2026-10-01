"""Benefits tools (agent: Benefícios)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from pydantic import Field

from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ProposalDraft, ToolContext, ToolError, ToolResult
from atrium.text import fold
from atrium.tools._util import company_policies, current_salary, d, money, plural

TIER = {"PLN-ESS": 1, "PLN-PLUS": 2, "PLN-PREM": 3, "ODO-BAS": 1, "ODO-PLUS": 2}


def _load(ctx: ToolContext):
    eid = ctx.identity.employee_id
    with ctx.hr() as hr:
        plans = {p.id: p for p in hr.benefits.plans()}
        enrollments = hr.benefits.enrollments(eid)
        dependents = hr.benefits.dependents(eid)
        balances = hr.benefits.balances(eid)
        salary = current_salary(hr.payroll.salary_history(eid))
    return plans, enrollments, dependents, balances, salary


def _cost(plan, n_deps: int) -> float:
    return float(Decimal(str(plan.employee_cost)) + Decimal(str(plan.dependent_cost)) * n_deps)


@tool("benefits_get_summary", params=NoArgs, action="self.benefits.read")
def benefits_get_summary(ctx: ToolContext, args: NoArgs) -> ToolResult:
    plans, enrollments, dependents, balances, salary = _load(ctx)
    dep_names = {x.id: x.name for x in dependents}
    out: dict = {"plans": []}
    for e in enrollments:
        p = plans[e.plan_id]
        out["plans"].append({"kind": p.kind, "plan_id": p.id, "name": p.name, "operator": p.operator, "since": e.since.isoformat(),
                             "accommodation": p.accommodation, "coverage": p.coverage, "copay": p.copay,
                             "dependents": [dep_names.get(x, x) for x in e.dependents], "monthly_cost": _cost(p, len(e.dependents))})
    if balances:
        out.update({
            "meal_card_monthly": balances.meal_card_monthly, "food_card_monthly": balances.food_card_monthly,
            "flex_balance": balances.flex_balance, "daycare_children": balances.daycare_children,
            "daycare_monthly_per_child": balances.daycare_monthly_per_child,
            "life_insurance_coverage": float(salary * balances.life_insurance_multiple),
            "life_insurance_multiple": balances.life_insurance_multiple, "wellness": balances.wellness,
            "transport_voucher": balances.transport_voucher,
        })
    health = next((p for p in out["plans"] if p["kind"] == "health"), None)
    summary = "Seus benefícios:"
    if health:
        deps = f" com {plural(len(health['dependents']), 'dependente', 'dependentes')}" if health["dependents"] else ""
        summary += f" plano de saúde {health['name']}{deps} (custo mensal para você {money(health['monthly_cost'])});"
    if balances:
        summary += (f" vale-refeição de {money(balances.meal_card_monthly)} e vale-alimentação de {money(balances.food_card_monthly)} por mês;"
                    f" saldo flexível de {money(balances.flex_balance)}; seguro de vida de {balances.life_insurance_multiple} salários.")
    return ToolResult(data=out, summary=summary, card=Card("benefits_summary", out))


class CompareArgs(Args):
    kind: str = Field("health", description="health (saúde) ou dental (odontológico)")


@tool("benefits_compare_plans", params=CompareArgs, action="self.benefits.read")
def benefits_compare_plans(ctx: ToolContext, args: CompareArgs) -> ToolResult:
    if args.kind not in ("health", "dental"):
        raise ToolError("Escolha planos de saúde (health) ou odontológicos (dental).")
    plans, enrollments, _deps, _bal, _sal = _load(ctx)
    current = next((e for e in enrollments if plans[e.plan_id].kind == args.kind), None)
    n = len(current.dependents) if current else 0
    current_cost = _cost(plans[current.plan_id], n) if current else 0.0
    rows = []
    for p in sorted((p for p in plans.values() if p.kind == args.kind), key=lambda p: TIER.get(p.id, 0)):
        cost = _cost(p, n)
        rows.append({"plan_id": p.id, "name": p.name, "accommodation": p.accommodation, "coverage": p.coverage, "copay": p.copay,
                     "reimbursement": p.reimbursement, "highlights": p.highlights, "monthly_cost": cost,
                     "annual_cost": round(cost * 12, 2), "difference": round(cost - current_cost, 2),
                     "current": bool(current and current.plan_id == p.id)})
    rule = company_policies()["benefits"]["plan_change"]
    data = {"kind": args.kind, "dependents_on_plan": n, "plans": rows,
            "rules": [f"Troca na janela anual de {rule['annual_window_start'][3:]}/{rule['annual_window_start'][:2]} a "
                      f"{rule['annual_window_end'][3:]}/{rule['annual_window_end'][:2]}, vigência em 01/12.",
                      f"Evento de vida (nascimento, casamento): até {rule['life_event_window_days']} dias.",
                      f"Upgrade: carência de {rule['upgrade_waiting_days']} dias para internação em apartamento."]}
    cur = next((r for r in rows if r["current"]), None)
    summary = f"Comparei {len(rows)} planos considerando {plural(n, 'dependente', 'dependentes')} no plano."
    if cur:
        others = "; ".join(f"{r['name']} custaria {money(r['monthly_cost'])}/mês ({'+' if r['difference'] >= 0 else '-'}{money(abs(r['difference']))})"
                           for r in rows if not r["current"])
        summary += f" Hoje você paga {money(cur['monthly_cost'])}/mês no {cur['name']}. {others}."
    return ToolResult(data=data, summary=summary, card=Card("plan_comparison", data))


class ChangePlanArgs(Args):
    plan: str = Field(..., description="Nome ou código do plano desejado (ex.: Vitalis Plus)")


def _find_plan(plans, query: str):
    q = fold(query)
    for p in plans.values():
        if q in (fold(p.id), fold(p.name)) or fold(p.name.split()[-1]) == q or q in fold(p.name):
            return p
    return None


def _change_window(ctx: ToolContext, dependents) -> tuple[str, date]:
    rule = company_policies()["benefits"]["plan_change"]
    t = ctx.today
    start = date(t.year, *map(int, rule["annual_window_start"].split("-")))
    end = date(t.year, *map(int, rule["annual_window_end"].split("-")))
    effective = date(t.year, *map(int, rule["annual_window_effective"].split("-")))
    recent = [x for x in dependents if (t - x.birth_date).days <= rule["life_event_window_days"] and x.relationship == "filho(a)"]
    if recent:
        nxt = date(t.year + (t.month == 12), t.month % 12 + 1, 1)
        return "evento de vida (nascimento)", nxt
    if start <= t <= end:
        return "janela anual", effective
    if t < start:
        return f"agendada para a janela anual ({d(start)} a {d(end)})", effective
    return "agendada para a próxima janela anual", date(t.year + 1, effective.month, effective.day)


def _execute_change(ctx: ToolContext, args: dict) -> ToolResult:
    plans, enrollments, _deps, _bal, _sal = _load(ctx)
    target = plans[args["to_plan"]]
    current = next(e for e in enrollments if plans[e.plan_id].kind == target.kind)
    with ctx.hr() as hr:
        req = hr.benefits.request_plan_change(ctx.identity.employee_id, current.plan_id, target.id,
                                              date.fromisoformat(args["effective"]), args["reason"])
    return ToolResult(data={"request_id": req.id, "effective": req.effective_date.isoformat()},
                      summary=f"Troca para {target.name} registrada ({req.id}), com vigência em {d(req.effective_date)}.")


@tool("benefits_change_plan", params=ChangePlanArgs, action="self.benefits.change", executor=_execute_change)
def benefits_change_plan(ctx: ToolContext, args: ChangePlanArgs) -> ToolResult:
    plans, enrollments, dependents, _bal, _sal = _load(ctx)
    target = _find_plan(plans, args.plan)
    if target is None:
        return ToolResult.fail(f"Não encontrei o plano “{args.plan}”. Planos: " + ", ".join(p.name for p in plans.values()))
    current = next((e for e in enrollments if plans[e.plan_id].kind == target.kind), None)
    if current and current.plan_id == target.id:
        return ToolResult.fail(f"Você já está no {target.name}.")
    reason, effective = _change_window(ctx, dependents)
    n = len(current.dependents) if current else 0
    old = plans[current.plan_id] if current else None
    upgrade = TIER.get(target.id, 0) > TIER.get(old.id if old else "", 0)
    rule = company_policies()["benefits"]["plan_change"]
    details = [{"label": "De", "value": old.name if old else "sem plano"}, {"label": "Para", "value": target.name},
               {"label": "Vigência", "value": d(effective)}, {"label": "Motivo", "value": reason},
               {"label": "Novo custo mensal", "value": f"{money(_cost(target, n))} ({plural(n, 'dependente', 'dependentes')})"}]
    if upgrade:
        until = effective + timedelta(days=rule["upgrade_waiting_days"])
        details.append({"label": "Carência", "value": f"internação em apartamento a partir de {d(until)} ({rule['upgrade_waiting_days']} dias)"})
    draft = ProposalDraft(summary=f"Trocar {old.name if old else 'plano'} por {target.name}", details=details,
                          args={"to_plan": target.id, "effective": effective.isoformat(), "reason": reason})
    return ToolResult(data={"to_plan": target.id, "effective": effective.isoformat(), "upgrade": upgrade},
                      summary=f"Preparei a troca para o {target.name} com vigência em {d(effective)} ({reason}). "
                              "Por ser ação sensível, a confirmação pede verificação de identidade.",
                      proposal=draft)


class NewbornArgs(Args):
    birth_date: date = Field(..., description="Data de nascimento (AAAA-MM-DD)")
    name: str | None = Field(None, description="Nome do bebê, se já definido")


def _execute_newborn(ctx: ToolContext, args: dict) -> ToolResult:
    born = date.fromisoformat(args["birth_date"])
    eid = ctx.identity.employee_id
    with ctx.hr() as hr:
        existing = next((x for x in hr.benefits.dependents(eid) if x.birth_date == born and x.relationship == "filho(a)"), None)
        dep = existing or hr.benefits.add_dependent(eid, args.get("name") or "Recém-nascido (nome a informar)", "filho(a)", born,
                                                    False, True, "aguardando certidão")
        hr.benefits.enroll_dependent(eid, dep.id)
    return ToolResult(data={"dependent_id": dep.id}, summary="Inclusão no plano registrada; envie a certidão de nascimento ao DP.")


@tool("benefits_enroll_newborn", params=NewbornArgs, action="self.benefits.change", executor=_execute_newborn)
def benefits_enroll_newborn(ctx: ToolContext, args: NewbornArgs) -> ToolResult:
    rule = company_policies()["benefits"]["newborn"]
    deadline = args.birth_date + timedelta(days=rule["enroll_within_days"])
    plans, enrollments, _deps, _bal, _sal = _load(ctx)
    health = next((e for e in enrollments if plans[e.plan_id].kind == "health"), None)
    if health is None:
        return ToolResult.fail("Você não tem plano de saúde ativo para incluir dependentes.")
    plan = plans[health.plan_id]
    late = ctx.today > deadline
    details = [{"label": "Plano", "value": plan.name}, {"label": "Prazo sem carência", "value": f"até {d(deadline)} (Lei 9.656/1998, art. 12)"},
               {"label": "Custo adicional", "value": f"{money(plan.dependent_cost)}/mês"},
               {"label": "Documento", "value": "certidão de nascimento"}]
    if late:
        details.append({"label": "Atenção", "value": "O prazo de 30 dias passou: a inclusão terá carência."})
    data = {"plan": plan.name, "deadline": deadline.isoformat(), "dependent_cost": plan.dependent_cost, "late": late}
    draft = ProposalDraft(summary=f"Incluir o recém-nascido no {plan.name}", details=details,
                          args={"birth_date": args.birth_date.isoformat(), "name": args.name})
    return ToolResult(data=data, summary=(f"O bebê pode entrar no {plan.name} sem carência se a inclusão for feita até {d(deadline)}; "
                                          f"o custo adicional é {money(plan.dependent_cost)} por mês."), proposal=draft)


@tool("benefits_daycare_info", params=NoArgs, action="self.benefits.read")
def benefits_daycare_info(ctx: ToolContext, args: NoArgs) -> ToolResult:
    rule = company_policies()["benefits"]["daycare"]
    with ctx.hr() as hr:
        deps = hr.benefits.dependents(ctx.identity.employee_id)
    limit_days = rule["max_age_months"] * 30.44
    kids = [x for x in deps if x.relationship == "filho(a)" and (ctx.today - x.birth_date).days < limit_days]
    data = {"title": "Auxílio-creche", "items": [
        {"label": "Valor", "value": f"{money(rule['monthly_per_child'])} por mês, por filho"},
        {"label": "Idade", "value": f"até {rule['max_age_months']} meses (6 anos)"},
        {"label": "Comprovação", "value": rule["requires"]},
        {"label": "Filhos elegíveis hoje", "value": str(len(kids))}],
        "eligible_children": len(kids), "monthly_per_child": rule["monthly_per_child"]}
    summary = (f"O auxílio-creche é de {money(rule['monthly_per_child'])} por mês para cada filho de até {rule['max_age_months']} meses, "
               f"mediante {rule['requires']}.")
    summary += f" Hoje você tem {plural(len(kids), 'filho elegível', 'filhos elegíveis')}." if kids else " Assim que o dependente estiver cadastrado, você pode pedir."
    return ToolResult(data=data, summary=summary, card=Card("kv", data))
