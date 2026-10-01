# ADR 0008: Local CPU embeddings and hybrid search

Status: accepted (2026-09-30)

## Context
Knowledge retrieval must work offline, cost nothing per query, understand Portuguese, and
be testable deterministically.

## Decision
- `EmbeddingProvider` interface with `FastEmbedProvider` (`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, 384 dimensions, 0.22 GB, Apache-2.0, ONNX on CPU) and `HashEmbeddingProvider` (deterministic feature hashing) for tests and CI.
- Hybrid retrieval: pgvector cosine distance plus Postgres full-text search (`portuguese` configuration, `ts_rank_cd`), fused with reciprocal rank fusion (k = 60). Filters by knowledge base ids the agent and identity can use.

## Alternatives rejected
- `multilingual-e5-large` (2.2 GB): better quality, too heavy for the target hardware.
- `potion-multilingual-128M` (static embeddings, 0.5 GB): very fast but weaker on short queries.
- Ollama: excluded by the hosting constraints; still pluggable through the interface.
- Hosted embeddings: cost and data residency.
