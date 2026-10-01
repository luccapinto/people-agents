"""Product name and fictional company data, from ``config/branding.json`` (single source)."""

from __future__ import annotations

import json
from functools import lru_cache

from atrium.config import REPO_ROOT


@lru_cache(maxsize=1)
def branding() -> dict:
    return json.loads((REPO_ROOT / "config/branding.json").read_text())
