"""Text normalization shared by search, routing and guardrails."""

from __future__ import annotations

import re
import unicodedata

_WS = re.compile(r"\s+")


def fold(value: str) -> str:
    """Lowercase, strip accents, collapse whitespace: "Férias  São" -> "ferias sao"."""
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _WS.sub(" ", ascii_only.lower()).strip()
