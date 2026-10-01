"""Business clock. ``ATRIUM_TODAY`` pins "today" for the fictional reference dataset."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

REFERENCE_TODAY = date(2026, 10, 1)


def today() -> date:
    value = os.environ.get("ATRIUM_TODAY", "").strip()
    if value:
        return date.fromisoformat(value)
    return date.today()


def now() -> datetime:
    """Wall-clock timestamp (UTC). Audit events use real time even when the date is pinned."""
    return datetime.now(timezone.utc)
