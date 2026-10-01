"""Intent classifier used by the deterministic router (ported to the demo as intent.ts).

A linear model over hashed features of the folded text: whole words, word pairs and character
n-grams of each word (so "olerite", "holerit" and "contracheque" still meet their neighbours).
Trained offline (``atrium train-router``; see ``intent_train.py`` and
docs/decisions/0017-round-2-3-router-and-guardrails.md); the weights live in
``shared/generated/intent-model.json`` and are read the same way by both engines.

Integer arithmetic plus one square root, so Python and the browser give bit-identical scores:
weights are stored scaled by ``SCALE``; a text's score for an agent is
``(bias + sum(weights of its features) / sqrt(number of its features)) / SCALE``.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache

from atrium.config import REPO_ROOT
from atrium.runtime.nlu import WORD
from atrium.text import fold

MODEL_PATH = REPO_ROOT / "shared/generated/intent-model.json"
SCALE = 100
FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193


def fnv1a(text: str) -> int:
    h = FNV_OFFSET
    for b in text.encode("ascii", "ignore"):
        h = ((h ^ b) * FNV_PRIME) & 0xFFFFFFFF
    return h


def features(text: str, ngrams: tuple[int, ...], bits: int) -> list[int]:
    """Distinct hashed features of a text, in first-seen order."""
    toks = WORD.findall(fold(text))
    raw = [f"w:{t}" for t in toks] + [f"b:{a} {b}" for a, b in zip(toks, toks[1:], strict=False)]
    for t in toks:
        padded = f" {t} "
        raw += [f"c:{padded[i:i + n]}" for n in ngrams for i in range(len(padded) - n + 1)]
    mask = (1 << bits) - 1
    seen: dict[int, None] = {}
    for f in raw:
        seen.setdefault(fnv1a(f) & mask, None)
    return list(seen)


@dataclass(frozen=True)
class IntentModel:
    ngrams: tuple[int, ...]
    bits: int
    classes: tuple[str, ...]
    bias: tuple[int, ...]
    rows: dict[int, tuple[tuple[int, int], ...]]  # feature hash -> (class index, weight)
    training_sha256: str

    def scores(self, text: str) -> dict[str, float]:
        """Score of each agent the model knows, for this text."""
        feats = features(text, self.ngrams, self.bits)
        sums = [0] * len(self.classes)
        for f in feats:
            for ci, w in self.rows.get(f, ()):
                sums[ci] += w
        norm = math.sqrt(len(feats)) if feats else 1.0
        return {c: (self.bias[i] + sums[i] / norm) / SCALE for i, c in enumerate(self.classes)}


def parse_model(data: dict) -> IntentModel:
    rows = {f: tuple((flat[i], flat[i + 1]) for i in range(0, len(flat), 2)) for f, flat in zip(data["features"], data["rows"], strict=True)}
    return IntentModel(tuple(data["ngrams"]), data["hash_bits"], tuple(data["classes"]), tuple(data["bias"]), rows, data["training_sha256"])


@lru_cache(maxsize=1)
def intent_model() -> IntentModel | None:
    if not MODEL_PATH.exists():
        return None
    return parse_model(json.loads(MODEL_PATH.read_text()))
