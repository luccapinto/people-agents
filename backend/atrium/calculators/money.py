"""Money helpers: ``Decimal`` everywhere, half-up rounding to cents."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0")


def dec(value: Decimal | int | float | str) -> Decimal:
    """Convert to Decimal without binary float artefacts."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(repr(value))
    return Decimal(value)


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def num(value: Decimal) -> float:
    """JSON-friendly number with exactly two decimals of precision."""
    return float(cents(value))


def brl(value: Decimal | float) -> str:
    """Format as Brazilian currency: R$ 1.234,56."""
    v = cents(dec(value))
    sign = "-" if v < 0 else ""
    integer, frac = f"{abs(v):.2f}".split(".")
    groups = []
    while len(integer) > 3:
        groups.insert(0, integer[-3:])
        integer = integer[:-3]
    groups.insert(0, integer)
    return f"{sign}R$ {'.'.join(groups)},{frac}"
