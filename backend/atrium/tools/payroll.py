"""Compensation and payroll tools (agent: Remuneração e Folha). All math is in calculators."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from pydantic import Field

from atrium.calculators.holidays import holiday_map
from atrium.calculators.money import cents
from atrium.calculators.payroll import PayslipInput, net_salary, payslip, thirteenth
from atrium.calculators.pgbl import pgbl_simulation
from atrium.runtime.registry import tool
from atrium.runtime.tool import Args, Card, NoArgs, ToolContext, ToolError, ToolResult
from atrium.seed.company import _dsr_ratio
from atrium.tools._util import MONTHS, current_salary, d, ir_dependents, month_label, money, pct

TAXABLE_EXCLUDED = {"ABN", "ABN13"}


@tool("payroll_get_salary", params=NoArgs, action="self.payroll.read")
def payroll_get_salary(ctx: ToolContext, args: NoArgs) -> ToolResult:
    with ctx.hr() as hr:
        history = hr.payroll.salary_history(ctx.subject_id)
    if not history:
        return ToolResult.fail("Não encontrei histórico salarial.")
    current = history[-1]
    rows = [[h.effective_date.isoformat(), h.salary, h.reason] for h in history]
    first = Decimal(str(history[0].salary))
    growth = (Decimal(str(current.salary)) / first - 1) * 100 if first else Decimal(0)
    data = {"title": "Salário e histórico", "current_salary": current.salary, "since": current.effective_date.isoformat(),
            "columns": ["Vigência", "Salário", "Motivo"], "rows": rows, "money_columns": [1],
            "growth_percent": float(cents(growth))}
    summary = f"Seu salário atual é {money(current.salary)}, vigente desde {d(current.effective_date)} ({current.reason})."
    if len(history) > 1:
        summary += f" Desde a admissão o salário evoluiu {pct(growth)}."
    return ToolResult(data=data, summary=summary, card=Card("table", data))


class PayslipArgs(Args):
    month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$", description="Competência AAAA-MM (padrão: último mês pago)")
    kind: str = Field("monthly", description="monthly (mensal) ou plr")


@tool("payroll_get_payslip", params=PayslipArgs, action="self.payroll.read")
def payroll_get_payslip(ctx: ToolContext, args: PayslipArgs) -> ToolResult:
    with ctx.hr() as hr:
        slips = hr.payroll.payslips(ctx.subject_id)
    candidates = [p for p in slips if p.kind == args.kind]
    if args.month:
        candidates = [p for p in candidates if p.month == args.month]
    if not candidates:
        return ToolResult.fail("Não encontrei holerite para essa competência." + (
            f" O último disponível é de {month_label(slips[-1].month)}." if slips else ""))
    p = candidates[-1]
    data = {"id": p.id, "month": p.month, "month_label": month_label(p.month), "kind": p.kind,
            "lines": [ln.model_dump(exclude_none=True) for ln in p.lines], "gross": p.gross, "deductions": p.deductions,
            "net": p.net, "inss_base": p.inss_base, "irrf_base": p.irrf_base, "fgts": p.fgts, "paid_on": p.paid_on.isoformat(),
            "pdf_url": f"/api/documents/payslip/{p.month}?kind={p.kind}"}
    biggest = max((ln for ln in p.lines if ln.deduction), key=lambda ln: ln.deduction or 0, default=None)
    summary = (f"No holerite de {month_label(p.month)} o bruto foi {money(p.gross)}, os descontos {money(p.deductions)} "
               f"e o líquido {money(p.net)}, pago em {d(p.paid_on)}.")
    if biggest:
        summary += f" O maior desconto foi {biggest.label} ({money(biggest.deduction)})."
    return ToolResult(data=data, summary=summary, card=Card("payslip", data))


# --------------------------------------------------------------------------- projection
def _health_costs(hr, employee_id) -> tuple[Decimal, Decimal]:
    plans = {p.id: p for p in hr.benefits.plans()}
    health = dental = Decimal(0)
    for e in hr.benefits.enrollments(employee_id):
        p = plans[e.plan_id]
        cost = Decimal(str(p.employee_cost)) + Decimal(str(p.dependent_cost)) * len(e.dependents)
        if p.kind == "health":
            health = cost
        else:
            dental = cost
    return health, dental


def projection(ctx: ToolContext, year: int) -> dict:
    eid = ctx.identity.employee_id
    with ctx.hr() as hr:
        history = hr.payroll.salary_history(eid)
        slips = [p for p in hr.payroll.payslips(eid, year)]
        deps = ir_dependents(hr.benefits.dependents(eid))
        health, dental = _health_costs(hr, eid)
        requests = hr.vacation.requests(eid)
        balances = hr.benefits.balances(eid)
    salary = current_salary(history)
    hire = ctx.identity.hire_date
    hmap = holiday_map([year])
    months, items = [], {"salaries": Decimal(0), "overtime": Decimal(0), "vacation": Decimal(0), "vacation_third": Decimal(0),
                         "thirteenth": Decimal(0), "plr": Decimal(0)}
    taxable = inss_total = irrf_total = Decimal(0)
    actual = {p.month: p for p in slips if p.kind == "monthly"}
    extras = {p.month: p for p in slips if p.kind == "plr"}
    for m in range(1, 13):
        key = f"{year}-{m:02d}"
        first = date(year, m, 1)
        if first < date(hire.year, hire.month, 1):
            continue
        if key in actual:
            p = actual[key]
            lines, gross, net, kind = [ln.model_dump(exclude_none=True) for ln in p.lines], Decimal(str(p.gross)), Decimal(str(p.net)), "actual"
        else:
            vac = 0
            for r in requests:
                if r.status in ("approved", "pending_manager", "taken"):
                    vac += sum(1 for i in range(r.days) if (r.start + timedelta(days=i)).month == m and (r.start + timedelta(days=i)).year == year)
            ps = payslip(PayslipInput(month=first, salary=salary, dependents=deps, vacation_days=min(30, vac),
                                      dsr_ratio=_dsr_ratio(year, m, hmap), health_share=health, dental_share=dental,
                                      transport_voucher=bool(balances and balances.transport_voucher)))
            lines, gross, net, kind = ps.lines, ps.gross, ps.net, "projected"
        for ln in lines:
            e = Decimal(str(ln.get("earning", 0)))
            code = ln["code"]
            if code == "SAL":
                items["salaries"] += e
            elif code in ("HE50", "DSRHE"):
                items["overtime"] += e
            elif code == "FER":
                items["vacation"] += e
            elif code in ("FER13", "ABN", "ABN13"):
                items["vacation_third"] += e
            if code not in TAXABLE_EXCLUDED:
                taxable += e
            if code == "INSS":
                inss_total += Decimal(str(ln["deduction"]))
            if code.startswith("IRRF"):
                irrf_total += Decimal(str(ln["deduction"]))
        extra_gross = extra_net = Decimal(0)
        if key in extras:
            items["plr"] += Decimal(str(extras[key].gross))
            extra_gross += Decimal(str(extras[key].gross))
            extra_net += Decimal(str(extras[key].net))
        months.append({"month": key, "label": MONTHS[m - 1][:3], "gross": float(gross + extra_gross),
                       "net": float(net + extra_net), "kind": kind})
    months_worked = sum(1 for mm in months)  # months with salary in the year
    t13 = thirteenth(salary, months_worked, deps, date(year, 12, 1))
    items["thirteenth"] = t13.gross
    for mm in months:
        if mm["month"] == f"{year}-11":
            mm["gross"] = float(Decimal(str(mm["gross"])) + t13.first_installment)
            mm["net"] = float(Decimal(str(mm["net"])) + t13.first_installment)
        if mm["month"] == f"{year}-12":
            mm["gross"] = float(Decimal(str(mm["gross"])) + t13.gross - t13.first_installment)
            mm["net"] = float(Decimal(str(mm["net"])) + t13.second_installment)
    total_gross = sum(Decimal(str(mm["gross"])) for mm in months)
    total_net = sum(Decimal(str(mm["net"])) for mm in months)
    return {
        "year": year, "salary": float(salary), "months": months,
        "items": {k: float(cents(v)) for k, v in items.items()},
        "thirteenth": {"gross": float(t13.gross), "first": float(t13.first_installment), "second_net": float(t13.second_installment),
                       "inss": float(t13.inss), "irrf": float(t13.irrf)},
        "total_gross": float(cents(total_gross)), "total_net": float(cents(total_net)),
        "taxable_income": float(cents(taxable)), "inss_paid": float(cents(inss_total)), "irrf_paid": float(cents(irrf_total)),
        "health_annual": float(cents(health * 12)), "dependents": deps,
        "actual_until": max((mm["month"] for mm in months if mm["kind"] == "actual"), default=None),
    }


class YearArgs(Args):
    year: int | None = Field(None, description="Ano (padrão: ano atual)")


@tool("payroll_annual_projection", params=YearArgs, action="self.payroll.read")
def payroll_annual_projection(ctx: ToolContext, args: YearArgs) -> ToolResult:
    year = args.year or ctx.today.year
    if year != ctx.today.year:
        raise ToolError(f"A projeção está disponível para {ctx.today.year}.")
    data = projection(ctx, year)
    data["notes"] = ["Meses já pagos vêm dos holerites; os demais são projetados com o salário atual e as férias agendadas.",
                     "13º e PLR têm tributação exclusiva na fonte.", "PLR de 2026 é paga em março de 2027 e não entra nesta projeção."]
    summary = (f"Em {year} você deve receber {money(data['total_gross'])} brutos e cerca de {money(data['total_net'])} líquidos, "
               f"incluindo 13º de {money(data['thirteenth']['gross'])}")
    if data["items"]["plr"]:
        summary += f", PLR de {money(data['items']['plr'])}"
    if data["items"]["vacation_third"]:
        summary += f" e {money(data['items']['vacation_third'])} de 1/3 e abono de férias"
    summary += "."
    return ToolResult(data=data, summary=summary, card=Card("annual_projection", data))


class NetArgs(Args):
    gross: float | None = Field(None, gt=0, description="Salário bruto mensal a simular (padrão: o atual)")
    dependents: int | None = Field(None, ge=0, le=10, description="Dependentes para IR (padrão: os cadastrados)")


@tool("payroll_simulate_net", params=NetArgs, action="self.payroll.read")
def payroll_simulate_net(ctx: ToolContext, args: NetArgs) -> ToolResult:
    with ctx.hr() as hr:
        salary = current_salary(hr.payroll.salary_history(ctx.subject_id))
        deps = ir_dependents(hr.benefits.dependents(ctx.subject_id))
    gross = Decimal(str(args.gross)) if args.gross else salary
    n = args.dependents if args.dependents is not None else deps
    r = net_salary(gross, n, ctx.today)
    lines = [{"label": "Salário bruto", "value": float(r.gross), "kind": "earning"},
             {"label": "INSS (progressivo 2026)", "value": float(r.inss), "kind": "deduction"},
             {"label": "IRRF" + (" (com redução da Lei 15.270/2025)" if r.irrf_reduction else ""), "value": float(r.irrf), "kind": "deduction"}]
    data = {"title": "Simulação de salário líquido", "lines": lines, "gross": float(r.gross), "deductions": float(r.inss + r.irrf),
            "net": float(r.net), "notes": [f"Dedução do IRRF: {'desconto simplificado' if r.deduction_mode == 'simplified' else 'deduções legais'}; {n} dependente(s).",
                                           "Não inclui descontos de benefícios."]}
    summary = f"Com bruto de {money(r.gross)}, o líquido estimado é {money(r.net)} (INSS {money(r.inss)}, IRRF {money(r.irrf)})."
    return ToolResult(data=data, summary=summary, card=Card("breakdown", data))


class PgblArgs(Args):
    contribution_percent: float | None = Field(None, ge=0, le=12, description="Percentual da renda tributável a contribuir (padrão: 12%)")


@tool("payroll_simulate_pgbl", params=PgblArgs, action="self.payroll.read")
def payroll_simulate_pgbl(ctx: ToolContext, args: PgblArgs) -> ToolResult:
    p = projection(ctx, ctx.today.year)
    income = Decimal(str(p["taxable_income"]))
    contribution = cents(income * Decimal(str(args.contribution_percent)) / 100) if args.contribution_percent is not None else None
    s = pgbl_simulation(income, Decimal(str(p["inss_paid"])), p["dependents"], Decimal(str(p["health_annual"])),
                        contribution=contribution)
    data = {
        "year": p["year"], "taxable_income": float(s.taxable_income), "limit": float(s.limit), "contribution": float(s.contribution),
        "monthly_contribution": float(s.monthly_contribution), "tax_saving": float(s.tax_saving), "eligible": s.eligible,
        "best_model_without_pgbl": s.best_without_pgbl.model, "tax_without_pgbl": float(s.best_without_pgbl.tax),
        "tax_with_pgbl": float(s.complete_with_pgbl.tax), "scenarios": s.scenarios, "recommendation": s.recommendation,
        "assumptions": [f"Renda tributável estimada de {p['year']}: salários, horas extras e férias (sem 13º e PLR).",
                        f"Deduções: INSS {money(p['inss_paid'])}, {p['dependents']} dependente(s), plano de saúde {money(p['health_annual'])}.",
                        "Vale para quem declara no modelo completo e contribui para o INSS.",
                        "No resgate do PGBL o imposto incide sobre o valor total (regime progressivo ou regressivo)."],
    }
    if s.tax_saving > 0:
        summary = (f"Contribuindo {money(s.contribution)} no ano (cerca de {money(s.monthly_contribution)} por mês, o limite de 12% "
                   f"da sua renda tributável de {money(s.taxable_income)}), a economia estimada de IR é {money(s.tax_saving)}: "
                   f"o imposto anual cai de {money(s.best_without_pgbl.tax)} para {money(s.complete_with_pgbl.tax)}.")
    else:
        summary = s.recommendation
    return ToolResult(data=data, summary=summary, card=Card("pgbl_simulation", data))
