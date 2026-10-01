"""Embedding providers. ``fastembed`` runs a small multilingual model on CPU; ``hash`` is a
deterministic feature-hashing embedder for tests and CI (see ADR 0008)."""

from __future__ import annotations

import hashlib
import math
from functools import lru_cache
from typing import Protocol

from atrium.runtime.nlu import tokens

DIM = 384
FASTEMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


class Embedder(Protocol):
    name: str
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedder:
    name = "hash"
    dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            toks = tokens(text)
            vec = [0.0] * self.dim
            feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:], strict=False)]
            for f in feats:
                h = hashlib.blake2b(f.encode(), digest_size=8).digest()
                idx = int.from_bytes(h[:4], "little") % self.dim
                sign = 1.0 if h[4] & 1 else -1.0
                vec[idx] += sign * (1.0 if "_" not in f else 0.5)
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out


class FastEmbedEmbedder:
    name = "fastembed"
    dim = DIM

    def __init__(self) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=FASTEMBED_MODEL)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self._model.embed(texts, batch_size=16)]


@lru_cache(maxsize=2)
def get_embedder(kind: str) -> Embedder:
    if kind == "fastembed":
        return FastEmbedEmbedder()
    return HashEmbedder()
