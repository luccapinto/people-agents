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


def build_kb_chunks() -> dict:
    """Knowledge chunks for the demo's in-browser index (same chunker as the back-end)."""
    from atrium.kb.chunking import chunk_markdown, snippet
    from atrium.kb.seed import KB_DIR, manifest

    bases, chunks = [], []
    for kb in manifest():
        bases.append({"id": kb["id"], "name": kb["name"], "description": kb.get("description", ""),
                      "audience": kb.get("audience") or {"type": "all"}})
        for doc in kb["documents"]:
            for c in chunk_markdown((KB_DIR / kb["id"] / doc).read_text(), fallback_title=doc):
                chunks.append({"id": f"{kb['id']}/{doc}#{c.ordinal}", "kb": kb["id"], "source": f"{kb['id']}/{doc}",
                               "document": c.title, "section": c.heading, "content": c.content, "snippet": snippet(c.content)})
    return {"knowledge_bases": bases, "chunks": chunks}


def export_all() -> list[Path]:
    return [
        _dump(GENERATED / "dataset.json", build_dataset()),
        _dump(GENERATED / "catalog.json", build_catalog()),
        _dump(GENERATED / "kb-chunks.json", build_kb_chunks()),
    ]


def export_goldens() -> Path:
    """Replays the golden scenarios on the (reset) test database; see atrium.goldens."""
    from atrium.goldens import build_goldens

    return _dump(GENERATED / "goldens.json", build_goldens())
