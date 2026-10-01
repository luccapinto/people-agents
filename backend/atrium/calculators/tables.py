"""Official tax tables, versioned by validity date.

Every table cites its source and the date it was checked. A table applies from
``valid_from`` (inclusive) until the next table's ``valid_from``. Values are ``Decimal``
strings copied verbatim from the official publication.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal as D


@dataclass(frozen=True)
class InssTable:
    valid_from: date
    # (upper bound of the bracket, rate). The last upper bound is the contribution ceiling.
    brackets: tuple[tuple[D, D], ...]
    source: str


@dataclass(frozen=True)
class IrrfBracket:
    upper: D | None  # None = no upper bound
    rate: D
    deduction: D


@dataclass(frozen=True)
class IncomeReduction:
    """Lei 15.270/2025 reduction (art. 3º-A of Lei 9.250/1995).

    Income up to ``full_limit``: reduction up to ``full_amount`` (tax becomes zero).
    Income up to ``phase_out_limit``: reduction = ``intercept - slope * income``.
    The income is the gross taxable income, not the tax base.
    """

    full_limit: D
    full_amount: D
    phase_out_limit: D
    intercept: D
    slope: D


@dataclass(frozen=True)
class IrrfTable:
    valid_from: date
    brackets: tuple[IrrfBracket, ...]
    dependent_deduction: D
    simplified_discount: D | None  # monthly: fixed amount; annual: see simplified_rate/cap
    reduction: IncomeReduction | None
    source: str
    simplified_rate: D | None = None  # annual simplified discount rate (20%)


# SOURCE: Portaria Interministerial MPS/MF nº 6/2025 (2025) and nº 13 de 09/01/2026 (2026).
# https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal
# Checked 2026-09-30. The 2025 table is also validated by the RFB worked examples of Lei 15.270.
INSS_TABLES: tuple[InssTable, ...] = (
    InssTable(
        date(2025, 1, 1),
        ((D("1518.00"), D("0.075")), (D("2793.88"), D("0.09")), (D("4190.83"), D("0.12")), (D("8157.41"), D("0.14"))),
        "Portaria Interministerial MPS/MF nº 6/2025",
    ),
    InssTable(
        date(2026, 1, 1),
        ((D("1621.00"), D("0.075")), (D("2902.84"), D("0.09")), (D("4354.27"), D("0.12")), (D("8475.55"), D("0.14"))),
        "Portaria Interministerial MPS/MF nº 13/2026",
    ),
)

_MONTHLY_2025_JAN_APR = (
    IrrfBracket(D("2259.20"), D("0"), D("0")),
    IrrfBracket(D("2826.65"), D("0.075"), D("169.44")),
    IrrfBracket(D("3751.05"), D("0.15"), D("381.44")),
    IrrfBracket(D("4664.68"), D("0.225"), D("662.77")),
    IrrfBracket(None, D("0.275"), D("896.00")),
)
_MONTHLY_FROM_2025_05 = (
    IrrfBracket(D("2428.80"), D("0"), D("0")),
    IrrfBracket(D("2826.65"), D("0.075"), D("182.16")),
    IrrfBracket(D("3751.05"), D("0.15"), D("394.16")),
    IrrfBracket(D("4664.68"), D("0.225"), D("675.49")),
    IrrfBracket(None, D("0.275"), D("908.73")),
)

MONTHLY_REDUCTION_2026 = IncomeReduction(
    full_limit=D("5000.00"),
    full_amount=D("312.89"),
    phase_out_limit=D("7350.00"),
    intercept=D("978.62"),
    slope=D("0.133145"),
)

ANNUAL_REDUCTION_2026 = IncomeReduction(
    full_limit=D("60000.00"),
    full_amount=D("2694.15"),
    phase_out_limit=D("88200.00"),
    intercept=D("8429.73"),
    slope=D("0.095575"),
)

# SOURCE: Receita Federal, "Tributação de 2025" and "Tributação de 2026".
# https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025
# https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026
# Checked 2026-09-30.
IRRF_MONTHLY_TABLES: tuple[IrrfTable, ...] = (
    IrrfTable(date(2025, 1, 1), _MONTHLY_2025_JAN_APR, D("189.59"), D("564.80"), None, "Lei 14.848/2024"),
    IrrfTable(date(2025, 5, 1), _MONTHLY_FROM_2025_05, D("189.59"), D("607.20"), None, "Lei 15.191/2025"),
    IrrfTable(
        date(2026, 1, 1),
        _MONTHLY_FROM_2025_05,
        D("189.59"),
        D("607.20"),
        MONTHLY_REDUCTION_2026,
        "Lei 15.191/2025 + Lei 15.270/2025",
    ),
)

# Annual adjustment table for calendar year 2026 (return filed in 2027).
IRPF_ANNUAL_2026 = IrrfTable(
    date(2026, 1, 1),
    (
        IrrfBracket(D("29145.60"), D("0"), D("0")),
        IrrfBracket(D("33919.80"), D("0.075"), D("2185.92")),
        IrrfBracket(D("45012.60"), D("0.15"), D("4729.91")),
        IrrfBracket(D("55976.16"), D("0.225"), D("8105.85")),
        IrrfBracket(None, D("0.275"), D("10904.66")),
    ),
    dependent_deduction=D("2275.08"),
    simplified_discount=D("17640.00"),  # cap of the 20% simplified discount
    reduction=ANNUAL_REDUCTION_2026,
    source="RFB Tributação de 2026 (incidência anual) + Lei 15.270/2025",
    simplified_rate=D("0.20"),
)

# SOURCE: RFB "Tributação de 2026", PLR table valid from May 2025. Checked 2026-09-30.
PLR_TABLE = (
    IrrfBracket(D("8214.40"), D("0"), D("0")),
    IrrfBracket(D("9922.28"), D("0.075"), D("616.08")),
    IrrfBracket(D("13167.00"), D("0.15"), D("1360.25")),
    IrrfBracket(D("16380.38"), D("0.225"), D("2347.78")),
    IrrfBracket(None, D("0.275"), D("3166.80")),
)

# Annual limit for education expenses (calendar year 2026).
EDUCATION_ANNUAL_LIMIT_2026 = D("3561.50")


def _pick(tables, on: date):
    chosen = None
    for t in tables:
        if t.valid_from <= on:
            chosen = t
    if chosen is None:
        raise ValueError(f"no table valid on {on.isoformat()}")
    return chosen


def inss_table(on: date) -> InssTable:
    return _pick(INSS_TABLES, on)


def irrf_monthly_table(on: date) -> IrrfTable:
    return _pick(IRRF_MONTHLY_TABLES, on)
