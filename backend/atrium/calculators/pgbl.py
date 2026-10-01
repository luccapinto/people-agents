"""Annual income tax (calendar year 2026) and PGBL deduction simulation.

SOURCE: RFB "Tributação de 2026" (annual table, annual reduction of Lei 15.270/2025,
dependent R$ 2.275,08, simplified discount 20% capped at R$ 17.640,00) and Lei 9.532/1997
art. 11 (PGBL deductible up to 12% of the taxable income, complete model only, taxpayer
must contribute to the official social security regime). Checked 2026-09-30.

The 13th salary and PLR are exclusively taxed at source and do not enter the annual base.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import ZERO, cents, dec
from .tables import EDUCATION_ANNUAL_LIMIT_2026, IRPF_ANNUAL_2026, IrrfBracket

PGBL_LIMIT_RATE = Decimal("0.12")


def _bracket(base: Decimal) -> IrrfBracket:
    for b in IRPF_ANNUAL_2026.brackets:
        if b.upper is None or base <= b.upper:
            return b
    return IRPF_ANNUAL_2026.brackets[-1]


def _annual_reduction(income: Decimal, tax: Decimal) -> Decimal:
    r = IRPF_ANNUAL_2026.reduction
    assert r is not None
    if tax <= 0:
        return ZERO
    if income <= r.full_limit:
        return min(tax, r.full_amount)
    if income <= r.phase_out_limit:
        return max(ZERO, min(tax, cents(r.intercept - r.slope * income)))
    return ZERO


@dataclass(frozen=True)
class AnnualTax:
    model: str  # "complete" | "simplified"
    taxable_income: Decimal
    deductions: Decimal
    base: Decimal
    tax_before_reduction: Decimal
    reduction: Decimal
    tax: Decimal
    effective_rate: Decimal


def annual_tax(
    taxable_income: Decimal,
    model: str,
    inss_paid: Decimal = ZERO,
    dependents: int = 0,
    health_expenses: Decimal = ZERO,
    education_expenses: Decimal = ZERO,
    pgbl: Decimal = ZERO,
) -> AnnualTax:
    income = dec(taxable_income)
    if model == "simplified":
        assert IRPF_ANNUAL_2026.simplified_rate is not None and IRPF_ANNUAL_2026.simplified_discount is not None
        deductions = min(cents(income * IRPF_ANNUAL_2026.simplified_rate), IRPF_ANNUAL_2026.simplified_discount)
    elif model == "complete":
        pgbl_cap = cents(income * PGBL_LIMIT_RATE)
        deductions = (
            dec(inss_paid)
            + IRPF_ANNUAL_2026.dependent_deduction * dependents
            + dec(health_expenses)
            + min(dec(education_expenses), EDUCATION_ANNUAL_LIMIT_2026 * (1 + dependents))
            + min(dec(pgbl), pgbl_cap)
        )
    else:
        raise ValueError(model)
    base = max(ZERO, income - deductions)
    b = _bracket(base)
    tax = max(ZERO, cents(base * b.rate - b.deduction))
    reduction = _annual_reduction(income, tax)
    final = cents(tax - reduction)
    rate = (final / income).quantize(Decimal("0.0001")) if income else ZERO
    return AnnualTax(model, cents(income), cents(deductions), cents(base), tax, reduction, final, rate)


@dataclass(frozen=True)
class PgblSimulation:
    eligible: bool
    reasons: list[str]
    taxable_income: Decimal
    limit: Decimal
    contribution: Decimal
    monthly_contribution: Decimal
    best_without_pgbl: AnnualTax
    complete_with_pgbl: AnnualTax
    tax_saving: Decimal
    saving_rate: Decimal  # saving / contribution
    recommendation: str
    scenarios: list[dict]


def pgbl_simulation(
    taxable_income: Decimal,
    inss_paid: Decimal,
    dependents: int,
    health_expenses: Decimal,
    education_expenses: Decimal = ZERO,
    contribution: Decimal | None = None,
    contributes_to_official_regime: bool = True,
) -> PgblSimulation:
    """Compare the best model without PGBL against the complete model with PGBL.

    ``contribution`` defaults to the 12% limit. Scenarios at 0%, 4%, 8% and 12% of the
    taxable income are returned for the chart.
    """
    income = dec(taxable_income)
    limit = cents(income * PGBL_LIMIT_RATE)
    reasons: list[str] = []
    if not contributes_to_official_regime:
        reasons.append("A dedução exige contribuição para o regime oficial de previdência (INSS).")
    common = dict(inss_paid=inss_paid, dependents=dependents, health_expenses=health_expenses,
                  education_expenses=education_expenses)
    simplified = annual_tax(income, "simplified")
    complete0 = annual_tax(income, "complete", **common)
    best0 = simplified if simplified.tax <= complete0.tax else complete0
    amount = limit if contribution is None else min(dec(contribution), limit)
    with_pgbl = annual_tax(income, "complete", pgbl=amount, **common)
    eligible = not reasons
    saving = max(ZERO, cents(best0.tax - with_pgbl.tax)) if eligible else ZERO
    if not eligible:
        rec = "Sem direito à dedução do PGBL nas condições informadas."
    elif saving <= 0:
        rec = "O PGBL não reduz seu imposto: com a isenção/redução vigente, seu IR anual estimado já é zero ou o modelo simplificado é melhor."
    else:
        rec = "Contribuir até o limite de 12% e declarar no modelo completo reduz o IR anual estimado."
    scenarios = []
    for pct in (Decimal("0"), Decimal("0.04"), Decimal("0.08"), Decimal("0.12")):
        c = cents(income * pct)
        t = annual_tax(income, "complete", pgbl=c, **common)
        best_tax = min(t.tax, simplified.tax) if pct == 0 else t.tax
        scenarios.append({
            "percent": float(pct * 100),
            "contribution": float(c),
            "tax": float(best_tax),
            "saving": float(max(ZERO, cents(best0.tax - best_tax))) if eligible else 0.0,
        })
    return PgblSimulation(
        eligible=eligible,
        reasons=reasons,
        taxable_income=cents(income),
        limit=limit,
        contribution=amount,
        monthly_contribution=cents(amount / 12),
        best_without_pgbl=best0,
        complete_with_pgbl=with_pgbl,
        tax_saving=saving,
        saving_rate=(saving / amount).quantize(Decimal("0.0001")) if amount else ZERO,
        recommendation=rec,
        scenarios=scenarios,
    )
