# STATUS

Single source of truth for where the build is. Updated at the end of every phase.

**Current phase:** 0 — research and plan (done)

## Plan

| Phase | Scope | State |
|---|---|---|
| 0 | Research, architecture, security model, ADRs | done |
| 1 | Domain, fictional dataset, ports/adapters, deterministic calculators + tests | pending |
| 2 | Authorization core (identity, policy engine, Postgres RLS) + adversarial suite | pending |
| 3 | Agent runtime (orchestrator, specialists, tools, proposals, guardrails, audit, LLM providers, SSE API) | pending |
| 4 | Knowledge base (ingestion, chunking, embeddings, hybrid search, citations, content) | pending |
| 5 | Chat front-end against the real back-end | pending |
| 6 | Governance console and Agent Studio | pending |
| 7 | Static demo (in-browser engine) and GitHub Pages workflow | pending |
| 8 | README, docs, CI, compose, screenshots, e2e, live smoke test | pending |

## Ready

- `docs/architecture.md`, `docs/security-model.md`, `docs/research.md`, `docs/decisions/0001-0014`.

## How to run / test

Not runnable yet.
