# STATUS

Single source of truth for where the build is. Updated at the end of every phase.

**Current phase:** 4 — knowledge base (done)

## Plan

| Phase | Scope | State |
|---|---|---|
| 0 | Research, architecture, security model, ADRs | done |
| 1 | Domain, fictional dataset, ports/adapters, deterministic calculators + tests | done |
| 2 | Authorization core (identity, policy engine, Postgres RLS) + adversarial suite (DB level; chat-level scenarios join in phase 3) | done |
| 3 | Agent runtime (orchestrator, specialists, tools, proposals, guardrails, audit, LLM providers, SSE API) | done |
| 4 | Knowledge base (ingestion, chunking, embeddings, hybrid search, citations, content) — hit@3: 20/20 hash+FTS (CI), 19/20 fastembed | done |
| 5 | Chat front-end against the real back-end | pending |
| 6 | Governance console and Agent Studio | pending |
| 7 | Static demo (in-browser engine) and GitHub Pages workflow | pending |
| 8 | README, docs, CI, compose, screenshots, e2e, live smoke test | pending |

## Ready

- `docs/architecture.md`, `docs/security-model.md`, `docs/research.md`, `docs/decisions/0001-0014`.
- `backend/atrium/calculators/`: INSS, IRRF (Lei 15.270 reduction), 13th, vacation pay, payslip, annual IR, PGBL, holidays, CLT vacation rules and window optimizer. Validated against the RFB worked examples (`shared/fixtures/calculators.json`).
- `backend/atrium/seed/company.py`: deterministic fictional company (116 active + 12 terminated), exported to `shared/generated/dataset.json`.
- Postgres schema with RLS (`backend/atrium/db/sql/*.sql`), ports (`atrium/ports`) and the reference SQL adapter.

## How to run / test

```bash
make db-up          # Postgres 16 + pgvector on localhost:55432 (compose project "atrium")
make generate       # regenerate shared/generated/* from the Python sources
make seed           # migrate + load the fictional company into the "atrium" database
make test-backend   # pytest (uses the "atrium_test" database)
```
