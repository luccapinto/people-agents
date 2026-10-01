"""Helpers shared by tool implementations (formatting, policies, common lookups)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache

import yaml

from atrium.calculators.holidays import holiday_map, is_non_working
from atrium.calculators.money import brl
from atrium.config import REPO_ROOT

MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


@lru_cache(maxsize=1)
def company_policies() -> dict:
    return yaml.safe_load((REPO_ROOT / "shared/catalog/company_policies.yaml").read_text())


def d(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def dm(value: date) -> str:
    return value.strftime("%d/%m")


def month_label(ym: str) -> str:
    y, m = ym.split("-")
    return f"{MONTHS[int(m) - 1]} de {y}"


def money(value) -> str:
    return brl(Decimal(str(value)))


def pct(value) -> str:
    """13.94 -> "13,9%"."""
    return f"{float(value):.1f}%".replace(".", ",")


def plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def hmap_for(today: date):
    return holiday_map(range(today.year - 1, today.year + 3))


def next_working_day(day: date, hmap) -> date:
    day += timedelta(days=1)
    while is_non_working(day, hmap):
        day += timedelta(days=1)
    return day


def current_salary(history) -> Decimal:
    return Decimal(str(history[-1].salary)) if history else Decimal(0)


def ir_dependents(dependents) -> int:
    return sum(1 for x in dependents if x.ir_dependent and x.status == "active")


def mask_account(account: str) -> str:
    digits = account.replace("-", "")
    return f"****{digits[-4:-1]}-{digits[-1]}" if len(digits) >= 4 else "****"
