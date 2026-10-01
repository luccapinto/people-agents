"""Tiny deterministic NLU used by the fake model and the lexical router (ported to the demo).

It is intentionally simple and transparent: normalization, light stemming, keyword
scoring, and parsers for dates, day counts, months, amounts, names and ids.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from atrium.text import fold

MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
STOPWORDS = set("""a o as os um uma uns umas de do da dos das em no na nos nas por para pra pro com sem e ou que
qual quais quanto quantos quantas como meu minha meus minhas seu sua eu voce me mim se ja eh e esta este isso essa esse
ao aos tem ter tenho sao foi ser estou vou mais menos muito pouco sobre ate quando onde porque pois tambem so mas
oi ola bom dia boa tarde noite favor obrigado obrigada""".split())
SUFFIXES = ("coes", "soes", "mente", "ados", "adas", "idos", "idas", "ando", "endo", "indo", "ado", "ada", "ido", "ida",
            "oes", "aes", "es", "as", "os", "is", "s", "a", "o", "e")
WORD = re.compile(r"[a-z0-9]+")


def stem(token: str) -> str:
    if len(token) <= 3 or token.isdigit():
        return token
    for suf in SUFFIXES:
        if token.endswith(suf) and len(token) - len(suf) >= 3:
            return token[: -len(suf)]
    return token


def tokens(text: str) -> list[str]:
    return [stem(t) for t in WORD.findall(fold(text)) if t not in STOPWORDS]


def contains_phrase(folded_text: str, phrase: str) -> bool:
    p = fold(phrase)
    return re.search(rf"(?<![a-z0-9]){re.escape(p)}(?![a-z0-9])", folded_text) is not None


# --------------------------------------------------------------------------- dates
DATE_FULL = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
DATE_SHORT = re.compile(r"\b(\d{1,2})/(\d{1,2})\b(?!/)")
DATE_WORDS = re.compile(r"\b(?:dia\s+)?(\d{1,2})\s+de\s+(" + "|".join(MONTHS) + r")(?:\s+de\s+(\d{4}))?")
ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _future_year(month: int, day: int, today: date) -> int:
    candidate = date(today.year, month, min(day, 28))
    return today.year + 1 if candidate < today - timedelta(days=60) else today.year


def parse_dates(text: str, today: date) -> list[date]:
    f = fold(text)
    found: list[tuple[int, date]] = []
    for m in ISO.finditer(f):
        try:
            found.append((m.start(), date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
        except ValueError:
            pass
    for m in DATE_FULL.finditer(f):
        try:
            found.append((m.start(), date(int(m.group(3)), int(m.group(2)), int(m.group(1)))))
        except ValueError:
            pass
    for m in DATE_SHORT.finditer(f):
        if any(abs(pos - m.start()) < 3 for pos, _ in found):
            continue
        day, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            try:
                found.append((m.start(), date(_future_year(month, day, today), month, day)))
            except ValueError:
                pass
    for m in DATE_WORDS.finditer(f):
        day, month = int(m.group(1)), MONTHS.index(m.group(2)) + 1
        year = int(m.group(3)) if m.group(3) else _future_year(month, day, today)
        try:
            found.append((m.start(), date(year, month, day)))
        except ValueError:
            pass
    rel = {"anteontem": -2, "ontem": -1, "hoje": 0, "amanha": 1}
    for word, delta in rel.items():
        m = re.search(rf"\b{word}\b", f)
        if m:
            found.append((m.start(), today + timedelta(days=delta)))
    found.sort(key=lambda x: x[0])
    out: list[date] = []
    for _, dt in found:
        if dt not in out:
            out.append(dt)
    return out


def parse_days(text: str) -> int | None:
    m = re.search(r"\b(\d{1,2})\s*dias?\b", fold(text))
    return int(m.group(1)) if m else None


def parse_sell_days(text: str) -> int:
    f = fold(text)
    m = re.search(r"vender\s+(\d{1,2})\s*dias?", f) or re.search(r"(\d{1,2})\s*dias?\s+vendid", f)
    if m:
        return int(m.group(1))
    return 10 if re.search(r"\b(vender|abono)\b", f) and "nao" not in f.split() else 0


def parse_month(text: str, today: date) -> str | None:
    f = fold(text)
    if "mes passado" in f or "ultimo holerite" in f or "ultimo mes" in f:
        prev = date(today.year, today.month, 1) - timedelta(days=1)
        return prev.strftime("%Y-%m")
    m = re.search(r"\b(\d{1,2})/(\d{4})\b", f)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{m.group(2)}-{int(m.group(1)):02d}"
    for i, name in enumerate(MONTHS):
        if re.search(rf"\b{name}\b", f):
            year_m = re.search(rf"{name}\s+(?:de\s+)?(\d{{4}})", f)
            year = int(year_m.group(1)) if year_m else (today.year if i + 1 <= today.month else today.year - 1)
            return f"{year}-{i + 1:02d}"
    return None


def parse_amount(text: str) -> float | None:
    f = fold(text)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*mil\b", f)
    if m:
        return float(m.group(1).replace(",", ".")) * 1000
    m = re.search(r"r\$\s*([\d.]+(?:,\d{1,2})?)", f)
    if m:
        return float(m.group(1).replace(".", "").replace(",", "."))
    return None


def parse_percent(text: str) -> float | None:
    m = re.search(r"(\d{1,2}(?:[.,]\d+)?)\s*%", text)
    return float(m.group(1).replace(",", ".")) if m else None


def parse_year(text: str) -> int | None:
    m = re.search(r"\b(20\d{2})\b", text)
    return int(m.group(1)) if m else None


NAME_RE = re.compile(r"\b(?:do|da|de|o|a|para o|para a)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)?)")
NOT_NAMES = {"Plataforma", "Tecnologia", "Vitalis", "Sorriso", "Nimbus", "Concierge", "Pessoas", "Dados", "Engenharia", "Infraestrutura",
             "Governança", "Financeiro", "Comercial", "Operações", "Atendimento"}


def parse_person(text: str) -> str | None:
    for m in NAME_RE.finditer(text):
        name = m.group(1)
        if name.split()[0] not in NOT_NAMES:
            return name
    return None


def parse_request_id(text: str) -> str | None:
    m = re.search(r"\bFER-\d+\b", text.upper())
    return m.group(0) if m else None


def parse_uuid(text: str) -> str | None:
    m = re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", text.lower())
    return m.group(0) if m else None


def parse_time(text: str) -> str | None:
    m = re.search(r"\b(\d{1,2})(?::|h)(\d{2})?\b", fold(text))
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2) or 0)
    return f"{h:02d}:{mm:02d}" if h < 24 and mm < 60 else None
