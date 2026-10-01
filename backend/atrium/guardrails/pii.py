"""Detection and masking of personal identifiers (Brazilian formats)."""

from __future__ import annotations

import re
from dataclasses import dataclass

CPF_RE = re.compile(r"(?<!\d)(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d)")
CNPJ_RE = re.compile(r"(?<!\d)(\d{2})\.?(\d{3})\.?(\d{3})/?(\d{4})-?(\d{2})(?!\d)")
CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
PHONE_RE = re.compile(r"(?<![\d,.])\(?\b\d{2}\)?[ ]?9?\d{4}-\d{4}\b")
ACCOUNT_RE = re.compile(r"\b(?:ag(?:[eê]ncia)?\.?\s*\d{3,5}[\s,;/-]*)?c(?:onta)?\s*(?:c(?:orrente)?\.?|/c)?\s*:?\s*\d{4,12}-?[\dxX]\b", re.IGNORECASE)


def _digits(s: str) -> list[int]:
    return [int(c) for c in s if c.isdigit()]


def valid_cpf(value: str) -> bool:
    d = _digits(value)
    if len(d) != 11 or len(set(d)) == 1:
        return False
    for n in (9, 10):
        s = sum(d[i] * (n + 1 - i) for i in range(n))
        if (s * 10) % 11 % 10 != d[n]:
            return False
    return True


def valid_cnpj(value: str) -> bool:
    d = _digits(value)
    if len(d) != 14 or len(set(d)) == 1:
        return False
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    w2 = [6, *w1]
    for weights, pos in ((w1, 12), (w2, 13)):
        s = sum(a * b for a, b in zip(d[:pos], weights, strict=True))
        r = s % 11
        if (0 if r < 2 else 11 - r) != d[pos]:
            return False
    return True


def luhn(value: str) -> bool:
    d = _digits(value)
    if not 13 <= len(d) <= 19:
        return False
    total = 0
    for i, n in enumerate(reversed(d)):
        if i % 2:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


@dataclass(frozen=True)
class PiiFinding:
    kind: str
    count: int


def find_pii(text: str) -> list[PiiFinding]:
    return mask_pii(text)[1]


def mask_pii(text: str) -> tuple[str, list[PiiFinding]]:
    counts: dict[str, int] = {}

    def sub(kind: str, label: str, regex: re.Pattern, validator=None):
        nonlocal text

        def repl(m: re.Match) -> str:
            if validator and not validator(m.group(0)):
                return m.group(0)
            counts[kind] = counts.get(kind, 0) + 1
            return label

        text = regex.sub(repl, text)

    sub("cnpj", "[CNPJ]", CNPJ_RE, valid_cnpj)
    sub("cpf", "[CPF]", CPF_RE, valid_cpf)
    sub("card", "[CARTÃO]", CARD_RE, luhn)
    sub("email", "[EMAIL]", EMAIL_RE)
    sub("bank_account", "[CONTA]", ACCOUNT_RE)
    sub("phone", "[TELEFONE]", PHONE_RE)
    return text, [PiiFinding(k, v) for k, v in counts.items()]


def mask_structure(value):
    """Recursively mask strings inside dicts/lists (audit payloads, stored traces)."""
    if isinstance(value, str):
        return mask_pii(value)[0]
    if isinstance(value, dict):
        return {k: mask_structure(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [mask_structure(v) for v in value]
    return value
