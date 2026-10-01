"""Payroll calculators: INSS, IRRF (with the Lei 15.270/2025 reduction), 13th salary,
vacation pay, monthly payslip and PLR.

All functions are pure. Inputs and outputs use ``Decimal``; rounding is half-up to cents
at the end of each tax computation, matching the Receita Federal worked examples.

Assumptions documented for readers (and repeated in the UI as caveats):
- Working-hour divisor 200 (40-hour week, the fictional company's schedule).
- The simplified monthly discount is applied when it beats legal deductions (monthly and
  vacation pay); it is not applied to the 13th salary exclusive taxation (legal deductions only).
- On vacation months INSS is computed on salary + vacation pay together (single salary of
  contribution); IRRF on vacation pay is computed separately, with INSS allocated pro rata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .money import ZERO, cents, dec
from .tables import PLR_TABLE, IrrfBracket, IrrfTable, inss_table, irrf_monthly_table

HOURS_DIVISOR = Decimal("200")
OVERTIME_RATE = Decimal("1.5")
VT_RATE = Decimal("0.06")
FGTS_RATE = Decimal("0.08")


# --------------------------------------------------------------------------- INSS
@dataclass(frozen=True)
class InssResult:
    base: Decimal
    amount: Decimal
    ceiling_applied: bool
    brackets: list[dict]


def inss(base: Decimal, on: date) -> InssResult:
    """Progressive employee INSS contribution (each bracket taxed at its own rate)."""
    base = dec(base)
    table = inss_table(on)
    ceiling = table.brackets[-1][0]
    capped = min(base, ceiling)
    lower = ZERO
    total = ZERO
    parts = []
    for upper, rate in table.brackets:
        if capped <= lower:
            break
        portion = min(capped, upper) - lower
        value = portion * rate
        total += value
        parts.append({"from": float(lower), "to": float(upper), "rate": float(rate), "value": float(cents(value))})
        lower = upper
    return InssResult(base=base, amount=cents(total), ceiling_applied=base > ceiling, brackets=parts)


# --------------------------------------------------------------------------- IRRF
@dataclass(frozen=True)
class IrrfResult:
    taxable_income: Decimal
    legal_deductions: Decimal
    simplified_discount: Decimal
    deduction_mode: str  # "legal" | "simplified"
    base: Decimal
    rate: Decimal
    bracket_deduction: Decimal
    tax_before_reduction: Decimal
    reduction: Decimal
    tax: Decimal


def _bracket(brackets: tuple[IrrfBracket, ...], base: Decimal) -> IrrfBracket:
    for b in brackets:
        if b.upper is None or base <= b.upper:
            return b
    return brackets[-1]


def _reduction(table: IrrfTable, income: Decimal, tax: Decimal) -> Decimal:
    r = table.reduction
    if r is None or tax <= 0:
        return ZERO
    if income <= r.full_limit:
        return min(tax, r.full_amount)
    if income <= r.phase_out_limit:
        value = cents(r.intercept - r.slope * income)
        return max(ZERO, min(tax, value))
    return ZERO


def irrf_monthly(
    taxable_income: Decimal,
    inss_amount: Decimal,
    dependents: int,
    on: date,
    other_deductions: Decimal = ZERO,
    allow_simplified: bool = True,
) -> IrrfResult:
    """Monthly withholding (tabela progressiva mensal + redução da Lei 15.270/2025).

    ``taxable_income`` is the gross taxable amount; the reduction is computed on it, not on
    the tax base (RFB example 5).
    """
    table = irrf_monthly_table(on)
    income = dec(taxable_income)
    legal = dec(inss_amount) + table.dependent_deduction * dependents + dec(other_deductions)
    simplified = table.simplified_discount or ZERO
    use_simplified = allow_simplified and simplified > legal
    deduction = simplified if use_simplified else legal
    base = max(ZERO, income - deduction)
    b = _bracket(table.brackets, base)
    tax = max(ZERO, cents(base * b.rate - b.deduction))
    reduction = _reduction(table, income, tax)
    return IrrfResult(
        taxable_income=income,
        legal_deductions=cents(legal),
        simplified_discount=simplified,
        deduction_mode="simplified" if use_simplified else "legal",
        base=cents(base),
        rate=b.rate,
        bracket_deduction=b.deduction,
        tax_before_reduction=tax,
        reduction=reduction,
        tax=cents(tax - reduction),
    )


def irrf_thirteenth(gross: Decimal, inss_amount: Decimal, dependents: int, on: date) -> IrrfResult:
    """Exclusive taxation of the 13th salary. Lei 15.270/2025 §3 extends the reduction to it."""
    return irrf_monthly(gross, inss_amount, dependents, on, allow_simplified=False)


def plr_tax(amount: Decimal) -> Decimal:
    """Exclusive taxation of profit sharing (tabela PLR, valid from May 2025)."""
    amount = dec(amount)
    b = _bracket(PLR_TABLE, amount)
    return max(ZERO, cents(amount * b.rate - b.deduction))


# --------------------------------------------------------------------------- 13th salary
@dataclass(frozen=True)
class ThirteenthResult:
    gross: Decimal
    months: int
    first_installment: Decimal
    inss: Decimal
    irrf: Decimal
    second_installment: Decimal
    net_total: Decimal


def thirteenth(salary: Decimal, months: int, dependents: int, on: date) -> ThirteenthResult:
    """13th salary: 1/12 of the salary per month worked (15+ days counts as a month).

    First installment (by 30 Nov or with vacation) is half the gross without deductions;
    the second (by 20 Dec) deducts INSS and IRRF computed on the full amount.
    """
    salary = dec(salary)
    gross = cents(salary * months / 12)
    first = cents(gross / 2)
    contribution = inss(gross, on).amount
    tax = irrf_thirteenth(gross, contribution, dependents, on).tax
    second = cents(gross - first - contribution - tax)
    return ThirteenthResult(gross, months, first, contribution, tax, second, cents(first + second))


# --------------------------------------------------------------------------- vacation pay
@dataclass(frozen=True)
class VacationPayResult:
    daily_rate: Decimal
    days: int
    sell_days: int
    vacation_gross: Decimal
    one_third: Decimal
    abono: Decimal
    abono_one_third: Decimal
    advance_13th: Decimal
    inss: Decimal
    irrf: Decimal
    gross_total: Decimal
    net_total: Decimal
    lines: list[dict] = field(default_factory=list)


def vacation_pay(
    salary: Decimal, days: int, sell_days: int, advance_13th: bool, dependents: int, on: date
) -> VacationPayResult:
    """Simulated vacation receipt.

    Vacation pay + 1/3 are taxable. Abono pecuniário + its 1/3 are not (Lei 8.212 art. 28
    §9º e.6; ADI PGFN 6/2006). The 13th advance is half the salary, without deductions.
    """
    salary = dec(salary)
    daily = salary / 30
    vacation_gross = cents(daily * days)
    third = cents(vacation_gross / 3)
    abono = cents(daily * sell_days)
    abono_third = cents(abono / 3)
    advance = cents(salary / 2) if advance_13th else ZERO
    taxable = vacation_gross + third
    contribution = inss(taxable, on).amount
    tax = irrf_monthly(taxable, contribution, dependents, on).tax
    gross_total = cents(taxable + abono + abono_third + advance)
    net = cents(gross_total - contribution - tax)
    lines = [
        {"code": "FER", "label": f"Férias ({days} dias)", "earning": float(vacation_gross)},
        {"code": "FER13", "label": "1/3 constitucional de férias", "earning": float(third)},
    ]
    if sell_days:
        lines.append({"code": "ABN", "label": f"Abono pecuniário ({sell_days} dias)", "earning": float(abono)})
        lines.append({"code": "ABN13", "label": "1/3 sobre abono", "earning": float(abono_third)})
    if advance_13th:
        lines.append({"code": "AD13", "label": "Adiantamento 13º salário", "earning": float(advance)})
    lines.append({"code": "INSS", "label": "INSS sobre férias", "deduction": float(contribution)})
    lines.append({"code": "IRRF", "label": "IRRF sobre férias", "deduction": float(tax)})
    return VacationPayResult(
        cents(daily), days, sell_days, vacation_gross, third, abono, abono_third, advance,
        contribution, tax, gross_total, net, lines,
    )


# --------------------------------------------------------------------------- payslip
@dataclass
class PayslipInput:
    month: date  # first day of the competence month
    salary: Decimal
    dependents: int = 0
    days_worked: int = 30  # commercial month: 30 days
    overtime_hours: Decimal = ZERO
    dsr_ratio: Decimal = ZERO  # rest days / business days of the month, for the DSR reflex
    vacation_days: int = 0
    vacation_sell_days: int = 0
    health_share: Decimal = ZERO
    dental_share: Decimal = ZERO
    transport_voucher: bool = False
    meal_discount: Decimal = ZERO


@dataclass(frozen=True)
class Payslip:
    month: date
    lines: list[dict]
    gross: Decimal
    deductions: Decimal
    net: Decimal
    inss_base: Decimal
    irrf_base: Decimal
    fgts: Decimal
    irrf_detail: dict


def payslip(p: PayslipInput) -> Payslip:
    """Monthly payslip with salary, overtime, DSR reflex, vacation and usual deductions."""
    salary = dec(p.salary)
    on = p.month
    lines: list[dict] = []
    worked_days = max(0, min(30, p.days_worked) - p.vacation_days)
    base_salary = cents(salary * worked_days / 30)
    lines.append({"code": "SAL", "label": f"Salário base ({worked_days} dias)", "earning": base_salary})
    overtime = cents(salary / HOURS_DIVISOR * OVERTIME_RATE * dec(p.overtime_hours))
    dsr = cents(overtime * dec(p.dsr_ratio))
    if overtime:
        lines.append({"code": "HE50", "label": f"Horas extras 50% ({dec(p.overtime_hours):g} h)", "earning": overtime})
        lines.append({"code": "DSRHE", "label": "DSR sobre horas extras", "earning": dsr})
    vac_gross = vac_third = abono = abono_third = ZERO
    if p.vacation_days:
        vac_gross = cents(salary / 30 * p.vacation_days)
        vac_third = cents(vac_gross / 3)
        lines.append({"code": "FER", "label": f"Férias ({p.vacation_days} dias)", "earning": vac_gross})
        lines.append({"code": "FER13", "label": "1/3 constitucional de férias", "earning": vac_third})
    if p.vacation_sell_days:
        abono = cents(salary / 30 * p.vacation_sell_days)
        abono_third = cents(abono / 3)
        lines.append({"code": "ABN", "label": f"Abono pecuniário ({p.vacation_sell_days} dias)", "earning": abono})
        lines.append({"code": "ABN13", "label": "1/3 sobre abono", "earning": abono_third})

    salary_part = base_salary + overtime + dsr
    vacation_part = vac_gross + vac_third
    inss_base = salary_part + vacation_part
    contribution = inss(inss_base, on).amount
    lines.append({"code": "INSS", "label": "INSS", "deduction": contribution})

    # Allocate INSS pro rata to compute the separate IRRF on vacation pay.
    inss_vac = cents(contribution * vacation_part / inss_base) if inss_base and vacation_part else ZERO
    inss_sal = contribution - inss_vac
    irrf_sal = irrf_monthly(salary_part, inss_sal, p.dependents, on)
    lines.append({"code": "IRRF", "label": "IRRF", "deduction": irrf_sal.tax})
    if vacation_part:
        irrf_vac = irrf_monthly(vacation_part, inss_vac, 0, on)
        lines.append({"code": "IRRFFER", "label": "IRRF sobre férias", "deduction": irrf_vac.tax})
    if p.health_share:
        lines.append({"code": "SAUDE", "label": "Plano de saúde (parte do colaborador)", "deduction": cents(dec(p.health_share))})
    if p.dental_share:
        lines.append({"code": "ODONTO", "label": "Plano odontológico", "deduction": cents(dec(p.dental_share))})
    if p.transport_voucher:
        lines.append({"code": "VT", "label": "Vale-transporte (6%)", "deduction": cents(base_salary * VT_RATE)})
    if p.meal_discount:
        lines.append({"code": "VR", "label": "Vale-refeição (participação)", "deduction": cents(dec(p.meal_discount))})

    gross = sum((ln.get("earning", ZERO) for ln in lines), ZERO)
    deductions = sum((ln.get("deduction", ZERO) for ln in lines), ZERO)
    out_lines = [
        {k: (float(v) if isinstance(v, Decimal) else v) for k, v in ln.items()} for ln in lines
    ]
    return Payslip(
        month=on,
        lines=out_lines,
        gross=cents(gross),
        deductions=cents(deductions),
        net=cents(gross - deductions),
        inss_base=cents(inss_base),
        irrf_base=irrf_sal.base,
        fgts=cents(inss_base * FGTS_RATE),
        irrf_detail={
            "deduction_mode": irrf_sal.deduction_mode,
            "tax_before_reduction": float(irrf_sal.tax_before_reduction),
            "reduction": float(irrf_sal.reduction),
        },
    )


@dataclass(frozen=True)
class NetSalary:
    gross: Decimal
    inss: Decimal
    irrf: Decimal
    irrf_reduction: Decimal
    deduction_mode: str
    other: Decimal
    net: Decimal


def net_salary(gross: Decimal, dependents: int, on: date, other_deductions: Decimal = ZERO) -> NetSalary:
    """Quick net salary simulation (INSS + IRRF + other fixed deductions)."""
    gross = dec(gross)
    contribution = inss(gross, on).amount
    tax = irrf_monthly(gross, contribution, dependents, on)
    other = cents(dec(other_deductions))
    return NetSalary(
        gross=cents(gross),
        inss=contribution,
        irrf=tax.tax,
        irrf_reduction=tax.reduction,
        deduction_mode=tax.deduction_mode,
        other=other,
        net=cents(gross - contribution - tax.tax - other),
    )
