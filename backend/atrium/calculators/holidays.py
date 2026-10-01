"""Holiday calendar for the company's sites.

SOURCE (checked 2026-09-30):
- National: Lei 662/1949 (as amended), Lei 6.802/1980 (12 Oct), Lei 14.759/2023 (20 Nov).
- Good Friday: religious holiday observed nationally (Lei 9.093/1995).
- São Paulo state: 9 July, Revolução Constitucionalista (Lei estadual 9.497/1997).
- São Paulo city: 25 January and Corpus Christi (Lei municipal 14.485/2007).
- Carnival Monday/Tuesday: optional days (ponto facultativo), granted by company policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache


@dataclass(frozen=True)
class Holiday:
    date: date
    name: str
    scope: str  # national | state | municipal | company

    def as_dict(self) -> dict:
        return {"date": self.date.isoformat(), "name": self.name, "scope": self.scope}


def easter(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


SITES = {
    "SP-SAO_PAULO": {"label": "São Paulo, SP", "state": "SP", "city": "São Paulo"},
}


@lru_cache(maxsize=64)
def holidays(year: int, site: str = "SP-SAO_PAULO") -> tuple[Holiday, ...]:
    if site not in SITES:
        raise ValueError(f"unknown site {site}")
    e = easter(year)
    items = [
        Holiday(date(year, 1, 1), "Confraternização Universal", "national"),
        Holiday(e - timedelta(days=48), "Carnaval (segunda-feira)", "company"),
        Holiday(e - timedelta(days=47), "Carnaval (terça-feira)", "company"),
        Holiday(e - timedelta(days=2), "Sexta-feira Santa", "national"),
        Holiday(date(year, 4, 21), "Tiradentes", "national"),
        Holiday(date(year, 5, 1), "Dia do Trabalho", "national"),
        Holiday(date(year, 9, 7), "Independência do Brasil", "national"),
        Holiday(date(year, 10, 12), "Nossa Senhora Aparecida", "national"),
        Holiday(date(year, 11, 2), "Finados", "national"),
        Holiday(date(year, 11, 15), "Proclamação da República", "national"),
        Holiday(date(year, 11, 20), "Dia Nacional de Zumbi e da Consciência Negra", "national"),
        Holiday(date(year, 12, 25), "Natal", "national"),
        Holiday(date(year, 7, 9), "Revolução Constitucionalista", "state"),
        Holiday(date(year, 1, 25), "Aniversário de São Paulo", "municipal"),
        Holiday(e + timedelta(days=60), "Corpus Christi", "municipal"),
    ]
    return tuple(sorted(items, key=lambda h: h.date))


def holiday_map(years: range | list[int], site: str = "SP-SAO_PAULO") -> dict[date, Holiday]:
    out: dict[date, Holiday] = {}
    for y in years:
        for h in holidays(y, site):
            out[h.date] = h
    return out


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def is_non_working(d: date, hmap: dict[date, Holiday]) -> bool:
    return is_weekend(d) or d in hmap


def business_days(year: int, month: int, site: str = "SP-SAO_PAULO") -> tuple[int, int]:
    """(business days, rest days) of a month — used for the DSR reflex on overtime."""
    hmap = holiday_map([year], site)
    d = date(year, month, 1)
    work = rest = 0
    while d.month == month:
        if is_non_working(d, hmap):
            rest += 1
        else:
            work += 1
        d += timedelta(days=1)
    return work, rest
