"""Calculators against the shared reference vectors (same file used by the TypeScript port)."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from atrium.calculators.holidays import easter, holiday_map
from atrium.calculators.payroll import inss, irrf_monthly, plr_tax, thirteenth, vacation_pay
from atrium.calculators.pgbl import annual_tax, pgbl_simulation
from atrium.calculators.vacation import best_windows

VECTORS = json.loads((Path(__file__).parents[3] / "shared/fixtures/calculators.json").read_text())


def d(x) -> Decimal:
    return Decimal(str(x))


@pytest.mark.parametrize("v", VECTORS["irrf_monthly"], ids=lambda v: v["ref"][:40])
def test_irrf_monthly(v):
    r = irrf_monthly(d(v["gross"]), d(v["inss"]), v["dependents"], date.fromisoformat(v["date"]))
    assert r.base == d(v["base"]).quantize(Decimal("0.01"))
    assert r.deduction_mode == v["mode"]
    assert r.tax_before_reduction == d(v["tax_before_reduction"]).quantize(Decimal("0.01"))
    assert r.reduction == d(v["reduction"]).quantize(Decimal("0.01"))
    assert r.tax == d(v["tax"]).quantize(Decimal("0.01"))


@pytest.mark.parametrize("v", VECTORS["inss"], ids=lambda v: v["ref"][:40])
def test_inss(v):
    assert inss(d(v["base"]), date.fromisoformat(v["date"])).amount == d(v["amount"]).quantize(Decimal("0.01"))


@pytest.mark.parametrize("v", VECTORS["plr"], ids=lambda v: v["ref"][:40])
def test_plr(v):
    assert plr_tax(d(v["amount"])) == d(v["tax"]).quantize(Decimal("0.01"))


@pytest.mark.parametrize("v", VECTORS["annual_tax"], ids=lambda v: v["ref"][:40])
def test_annual_tax(v):
    r = annual_tax(d(v["income"]), v["model"], inss_paid=d(v["inss"]), dependents=v["dependents"],
                   health_expenses=d(v["health"]), pgbl=d(v["pgbl"]))
    assert r.tax == d(v["tax"]).quantize(Decimal("0.01"))


@pytest.mark.parametrize("v", VECTORS["easter"], ids=lambda v: str(v["year"]))
def test_easter(v):
    assert easter(v["year"]).isoformat() == v["date"]


def test_best_five_day_window_bridges_carnival():
    v = VECTORS["vacation_best_5_day"]
    hmap = holiday_map([2026, 2027])
    top = best_windows([5], hmap, date.fromisoformat(v["earliest"]), date.fromisoformat(v["latest_end"]), top=1)[0]
    assert top.start.isoformat() == v["start"]
    assert top.rest_days == v["rest_days"]


def test_reduction_never_exceeds_tax_and_phases_out_at_7350():
    on = date(2026, 3, 1)
    for gross in range(4000, 8000, 37):
        c = inss(Decimal(gross), on).amount
        r = irrf_monthly(Decimal(gross), c, 0, on)
        assert Decimal(0) <= r.reduction <= r.tax_before_reduction
        if gross > 7350:
            assert r.reduction == 0
        if gross <= 5000:
            assert r.tax == 0


def test_thirteenth_installments_add_up():
    r = thirteenth(Decimal("9800"), 12, 1, date(2026, 12, 1))
    assert r.first_installment == Decimal("4900.00")
    assert r.first_installment + r.second_installment + r.inss + r.irrf == r.gross


def test_vacation_pay_abono_is_not_taxed():
    with_abono = vacation_pay(Decimal("9000"), 20, 10, False, 0, date(2026, 11, 1))
    without = vacation_pay(Decimal("9000"), 20, 0, False, 0, date(2026, 11, 1))
    assert with_abono.inss == without.inss
    assert with_abono.irrf == without.irrf
    assert with_abono.abono == Decimal("3000.00")
    assert with_abono.abono_one_third == Decimal("1000.00")
    assert with_abono.net_total - without.net_total == Decimal("4000.00")


def test_pgbl_requires_official_regime_and_caps_at_12_percent():
    s = pgbl_simulation(Decimal("120000"), Decimal("11857.08"), 1, Decimal("3600"), contribution=Decimal("50000"))
    assert s.limit == Decimal("14400.00")
    assert s.contribution == Decimal("14400.00")
    assert s.tax_saving == Decimal("3960.00")
    no_inss = pgbl_simulation(Decimal("120000"), Decimal("11857.08"), 1, Decimal("3600"), contributes_to_official_regime=False)
    assert not no_inss.eligible and no_inss.tax_saving == 0


def test_pgbl_gives_nothing_when_income_is_exempt():
    s = pgbl_simulation(Decimal("55000"), Decimal("5000"), 0, Decimal("0"))
    assert s.tax_saving == 0
