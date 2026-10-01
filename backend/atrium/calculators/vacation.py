"""Vacation rules (CLT) and the rest-maximizing window optimizer.

SOURCE (checked 2026-09-30):
- CLT art. 130: entitlement by unjustified absences (30/24/18/12 days).
- CLT art. 134 §1 (Lei 13.467/2017): up to three fractions, one >= 14 calendar days, the
  others >= 5 calendar days.
- CLT art. 134 §3: vacation cannot start in the two days preceding a holiday or the weekly
  paid rest (Sunday for the company's Monday–Friday schedule).
- CLT art. 135: notice of at least 30 days (company policy applies it to requests too).
- CLT art. 137 + TST Súmula 81: days enjoyed after the concession period are paid double.
- CLT art. 143: up to 1/3 of the entitlement may be converted into cash (abono); request
  up to 15 days before the end of the acquisition period (§1).

Vacation days are calendar days ("dias corridos"): a holiday inside the vacation does not
extend it. The optimizer therefore places vacations so that weekends and holidays sit
*around* them, maximizing consecutive rest per balance day.

All ordering uses integer keys so the TypeScript port reproduces results exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .holidays import Holiday, is_non_working

MIN_FRACTION = 5
MAIN_FRACTION = 14
MAX_FRACTIONS = 3
NOTICE_DAYS = 30


def entitlement_for_absences(unjustified_absences: int) -> int:
    if unjustified_absences <= 5:
        return 30
    if unjustified_absences <= 14:
        return 24
    if unjustified_absences <= 23:
        return 18
    if unjustified_absences <= 32:
        return 12
    return 0


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year + years, day=28)


def concession_end(acquisition_end: date) -> date:
    """Last day of the concession period: 12 months after the acquisition period ends."""
    return add_years(acquisition_end, 1)


@dataclass(frozen=True)
class Fraction:
    start: date
    days: int

    @property
    def end(self) -> date:
        return self.start + timedelta(days=self.days - 1)


@dataclass
class PeriodState:
    """What the rules need to know about one acquisition period."""

    acquisition_start: date
    acquisition_end: date
    entitled_days: int
    fractions: list[Fraction] = field(default_factory=list)  # taken + scheduled
    sold_days: int = 0

    @property
    def used_days(self) -> int:
        return sum(f.days for f in self.fractions) + self.sold_days

    @property
    def balance(self) -> int:
        return max(0, self.entitled_days - self.used_days)

    @property
    def has_main_fraction(self) -> bool:
        return any(f.days >= MAIN_FRACTION for f in self.fractions)

    @property
    def deadline(self) -> date:
        return concession_end(self.acquisition_end)


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    severity: str  # error | warning | info

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "severity": self.severity}


def start_issues(start: date, hmap: dict[date, Holiday]) -> list[Issue]:
    issues = []
    if is_non_working(start, hmap):
        issues.append(Issue("start_non_working", "As férias devem começar em um dia útil.", "error"))
    for offset in (1, 2):
        d = start + timedelta(days=offset)
        if d in hmap:
            issues.append(Issue(
                "start_before_holiday",
                f"Não é permitido iniciar férias nos 2 dias que antecedem feriado ({hmap[d].name}, {d.strftime('%d/%m')}) — CLT art. 134 §3º.",
                "error",
            ))
            break
        if d.weekday() == 6:
            issues.append(Issue(
                "start_before_rest",
                "Não é permitido iniciar férias nos 2 dias que antecedem o repouso semanal (domingo) — CLT art. 134 §3º.",
                "error",
            ))
            break
    return issues


def is_valid_start(start: date, hmap: dict[date, Holiday]) -> bool:
    return not start_issues(start, hmap)


def fraction_issues(period: PeriodState, days: int, sell_days: int = 0) -> list[Issue]:
    """Balance and splitting rules (CLT art. 134 §1, art. 143) for a vacation of ``days``, whatever
    the start date. Shared by the request validation and the window suggestions."""
    issues: list[Issue] = []
    balance = period.balance
    if days < MIN_FRACTION:
        issues.append(Issue("min_5", "Cada período de férias deve ter pelo menos 5 dias corridos (CLT art. 134 §1º).", "error"))
    if sell_days < 0 or sell_days > period.entitled_days // 3:
        issues.append(Issue("abono_max_third", f"O abono pecuniário é limitado a 1/3 do direito ({period.entitled_days // 3} dias) — CLT art. 143.", "error"))
    if days + sell_days > balance:
        issues.append(Issue("insufficient_balance", f"Saldo insuficiente: você tem {balance} dias disponíveis neste período.", "error"))
    if len(period.fractions) + 1 > MAX_FRACTIONS:
        issues.append(Issue("max_3_fractions", "As férias podem ser divididas em no máximo 3 períodos (CLT art. 134 §1º).", "error"))
    remaining = balance - days - sell_days
    if not period.has_main_fraction and days < MAIN_FRACTION and remaining < MAIN_FRACTION:
        issues.append(Issue("needs_14_day_fraction", "Um dos períodos precisa ter pelo menos 14 dias corridos; com esta divisão isso deixaria de ser possível (CLT art. 134 §1º).", "error"))
    if 0 < remaining < MIN_FRACTION:
        issues.append(Issue("remainder_below_5", f"Sobrariam {remaining} dias, menos que o mínimo de 5 para um novo período.", "error"))
    if len(period.fractions) + 1 == MAX_FRACTIONS and remaining > 0:
        issues.append(Issue("remainder_without_fraction", "Este seria o 3º período, mas ainda sobraria saldo sem período disponível.", "error"))
    return issues


def validate_request(
    period: PeriodState,
    start: date,
    days: int,
    sell_days: int,
    hmap: dict[date, Holiday],
    today: date,
) -> list[Issue]:
    issues = fraction_issues(period, days, sell_days)
    issues.extend(start_issues(start, hmap))
    if (start - today).days < NOTICE_DAYS:
        issues.append(Issue("notice_30_days", "A solicitação precisa de antecedência mínima de 30 dias (CLT art. 135 e política interna).", "error"))
    new = Fraction(start, days)
    for f in period.fractions:
        if new.start <= f.end and f.start <= new.end:
            issues.append(Issue("overlap", f"Conflita com férias já registradas a partir de {f.start.strftime('%d/%m/%Y')}.", "error"))
    late = (new.end - period.deadline).days
    if late > 0:
        issues.append(Issue("double_pay", f"{min(late, days)} dia(s) cairiam após o fim do período concessivo ({period.deadline.strftime('%d/%m/%Y')}) e seriam pagos em dobro (CLT art. 137).", "warning"))
    if sell_days and today > period.acquisition_end - timedelta(days=15):
        issues.append(Issue("abono_late", "O prazo legal para pedir o abono (15 dias antes do fim do período aquisitivo) passou; depende de concordância da empresa (CLT art. 143 §1º).", "warning"))
    return issues


# --------------------------------------------------------------------------- optimizer
@dataclass(frozen=True)
class Window:
    start: date
    days: int
    rest_start: date
    rest_end: date
    rest_days: int
    holidays_bridged: tuple[str, ...]
    holidays_inside: tuple[str, ...]

    @property
    def end(self) -> date:
        return self.start + timedelta(days=self.days - 1)

    @property
    def bonus_days(self) -> int:
        return self.rest_days - self.days

    @property
    def efficiency_x1000(self) -> int:
        return self.rest_days * 1000 // self.days

    def as_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "days": self.days,
            "rest_start": self.rest_start.isoformat(),
            "rest_end": self.rest_end.isoformat(),
            "rest_days": self.rest_days,
            "bonus_days": self.bonus_days,
            "efficiency": round(self.efficiency_x1000 / 1000, 3),
            "holidays_bridged": list(self.holidays_bridged),
            "holidays_inside": list(self.holidays_inside),
        }


def window_at(start: date, days: int, hmap: dict[date, Holiday]) -> Window:
    end = start + timedelta(days=days - 1)
    rest_start = start
    bridged: list[str] = []
    d = start - timedelta(days=1)
    while is_non_working(d, hmap):
        if d in hmap:
            bridged.append(hmap[d].name)
        rest_start = d
        d -= timedelta(days=1)
    rest_end = end
    d = end + timedelta(days=1)
    while is_non_working(d, hmap):
        if d in hmap:
            bridged.append(hmap[d].name)
        rest_end = d
        d += timedelta(days=1)
    inside = []
    d = start
    while d <= end:
        if d in hmap and d.weekday() < 5:
            inside.append(hmap[d].name)
        d += timedelta(days=1)
    return Window(start, days, rest_start, rest_end, (rest_end - rest_start).days + 1, tuple(bridged), tuple(inside))


def _sort_key(w: Window) -> tuple[int, int, int]:
    return (-w.efficiency_x1000, -w.rest_days, w.start.toordinal())


def _overlaps(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    return a_start <= b_end and b_start <= a_end


def candidate_windows(
    days: int,
    hmap: dict[date, Holiday],
    earliest: date,
    latest_end: date,
    blocked: list[Fraction] | None = None,
) -> list[Window]:
    blocked = blocked or []
    out = []
    start = earliest
    while start + timedelta(days=days - 1) <= latest_end:
        if is_valid_start(start, hmap):
            end = start + timedelta(days=days - 1)
            if not any(_overlaps(start, end, b.start, b.end) for b in blocked):
                out.append(window_at(start, days, hmap))
        start += timedelta(days=1)
    out.sort(key=_sort_key)
    return out


def best_windows(
    lengths: list[int],
    hmap: dict[date, Holiday],
    earliest: date,
    latest_end: date,
    blocked: list[Fraction] | None = None,
    top: int = 5,
) -> list[Window]:
    """Top windows across the given lengths whose rest blocks do not overlap each other."""
    pool: list[Window] = []
    for n in lengths:
        pool.extend(candidate_windows(n, hmap, earliest, latest_end, blocked))
    pool.sort(key=_sort_key)
    chosen: list[Window] = []
    for w in pool:
        if any(_overlaps(w.rest_start, w.rest_end, c.rest_start, c.rest_end) for c in chosen):
            continue
        chosen.append(w)
        if len(chosen) == top:
            break
    return chosen


def partitions(balance: int, slots: int, needs_main: bool) -> list[tuple[int, ...]]:
    """Ways to split ``balance`` into at most ``slots`` fractions obeying CLT art. 134 §1."""
    result: list[tuple[int, ...]] = []

    def rec(remaining: int, max_part: int, parts: tuple[int, ...]):
        if remaining == 0:
            if not needs_main or any(p >= MAIN_FRACTION for p in parts):
                result.append(parts)
            return
        if len(parts) == slots:
            return
        for p in range(min(max_part, remaining), MIN_FRACTION - 1, -1):
            rec(remaining - p, p, (*parts, p))

    rec(balance, balance, ())
    return result


@dataclass(frozen=True)
class Plan:
    windows: tuple[Window, ...]

    @property
    def rest_days(self) -> int:
        return sum(w.rest_days for w in self.windows)

    @property
    def used_days(self) -> int:
        return sum(w.days for w in self.windows)

    def as_dict(self) -> dict:
        return {
            "fractions": [w.as_dict() for w in sorted(self.windows, key=lambda w: w.start)],
            "used_days": self.used_days,
            "rest_days": self.rest_days,
            "bonus_days": self.rest_days - self.used_days,
        }


def plan_balance(
    period: PeriodState,
    hmap: dict[date, Holiday],
    earliest: date,
    latest_end: date,
    top: int = 3,
    per_length: int = 10,
) -> list[Plan]:
    """Best ways to use the whole balance of a period, maximizing total consecutive rest."""
    balance = period.balance
    slots = MAX_FRACTIONS - len(period.fractions)
    if balance < MIN_FRACTION or slots <= 0:
        return []
    parts_list = partitions(balance, slots, needs_main=not period.has_main_fraction)
    cache: dict[int, list[Window]] = {}
    plans: list[Plan] = []
    for parts in parts_list:
        options = []
        for n in parts:
            if n not in cache:
                cache[n] = best_windows([n], hmap, earliest, latest_end, period.fractions, top=per_length)
            options.append(cache[n])
        best = _best_combination(options)
        if best is not None:
            plans.append(best)
    plans.sort(key=_plan_key)
    unique: list[Plan] = []
    for p in plans:
        if all(_plan_signature(p) != _plan_signature(u) for u in unique):
            unique.append(p)
        if len(unique) == top:
            break
    return unique


def _best_combination(options: list[list[Window]]) -> Plan | None:
    """Exhaustive search over one window per fraction whose rest blocks do not overlap."""
    best: Plan | None = None

    def rec(i: int, picked: tuple[Window, ...]) -> None:
        nonlocal best
        if i == len(options):
            plan = Plan(picked)
            if best is None or _plan_key(plan) < _plan_key(best):
                best = plan
            return
        for w in options[i]:
            if any(_overlaps(w.rest_start, w.rest_end, p.rest_start, p.rest_end) for p in picked):
                continue
            rec(i + 1, (*picked, w))

    rec(0, ())
    return best


def _plan_key(p: Plan) -> tuple[int, int, int]:
    first = min(w.start for w in p.windows).toordinal()
    return (-p.rest_days, len(p.windows), first)


def _plan_signature(p: Plan) -> tuple:
    return tuple(sorted((w.start.toordinal(), w.days) for w in p.windows))
