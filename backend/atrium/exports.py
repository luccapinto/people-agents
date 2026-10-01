"""Generated artifacts shared with the front-end demo (committed, checked for drift by tests)."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from atrium.config import REPO_ROOT

GENERATED = REPO_ROOT / "shared/generated"


def _dump(path: Path, data) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + "\n")
    return path


def build_dataset() -> dict:
    from atrium.seed.company import generate

    return generate()


def build_catalog() -> dict:
    """YAML sources under shared/catalog as one JSON document for the browser."""
    out = {}
    for f in sorted((REPO_ROOT / "shared/catalog").glob("*.yaml")):
        out[f.stem] = yaml.safe_load(f.read_text())
    return out


def export_all() -> list[Path]:
    return [
        _dump(GENERATED / "dataset.json", build_dataset()),
        _dump(GENERATED / "catalog.json", build_catalog()),
    ]


def export_goldens() -> Path:
    """Replays the golden scenarios on the (reset) test database; see atrium.goldens."""
    from atrium.goldens import build_goldens

    return _dump(GENERATED / "goldens.json", build_goldens())
