# ADR 0013: Deterministic fake model and lexical router

Status: accepted (2026-09-30)

## Context
Tests must be deterministic and free; the demo needs free-text understanding without a model.

## Decision
Each agent has a routing profile (keywords, example utterances, description). The lexical
router normalizes text (lowercase, accents removed, light stemming), scores profiles with
BM25-like weights and fuzzy keyword matching, and returns one or more agents or a
clarification. The fake provider uses it for routing and tool selection and narrates with
the tools' deterministic summaries. The demo uses the TypeScript port of the same router.
Routing accuracy is measured on `shared/eval/routing.yaml` (more than 40 questions).

## Alternatives rejected
- Embedding-based routing in tests: heavier and less transparent.
