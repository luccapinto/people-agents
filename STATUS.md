# STATUS

Single source of truth for where the build is. Updated at the end of every phase.

**Current phase:** 7 — static demo (done); next: 8 finishing

## Plan

| Phase | Scope | State |
|---|---|---|
| 0 | Research, architecture, security model, ADRs | done |
| 1 | Domain, fictional dataset, ports/adapters, deterministic calculators + tests | done |
| 2 | Authorization core (identity, policy engine, Postgres RLS) + adversarial suite (DB level; chat-level scenarios join in phase 3) | done |
| 3 | Agent runtime (orchestrator, specialists, tools, proposals, guardrails, audit, LLM providers, SSE API) | done |
| 4 | Knowledge base (ingestion, chunking, embeddings, hybrid search, citations, content) — hit@3: 20/20 hash+FTS (CI), 19/20 fastembed | done |
| 5 | Chat front-end against the real back-end (React + Vite + TS + Tailwind; 25 card types; Por dentro; step-up) | done |
| 6 | Governance console and Agent Studio (lifecycle, evaluation gate, review with separation of duties, versions, playground, metrics) | done |
| 7 | Static demo (in-browser engine, parity goldens, hash routing) and GitHub Pages workflow — e2e 22/22 Chromium+WebKit on a no-fallback server | done |
| 8 | README, docs, CI, compose, screenshots, e2e, live smoke test | pending |


## What was looked at, and by whom

- **Main (me), in a browser:** chat desktop light after the font fix (empty state, life event with
  proposals, confirmation "Executado", Por dentro with tool decisions), chat at 390×844 (no
  overflow), chat dark with an injection attempt and the access denial in Por dentro, console
  overview dark desktop and at 390×844 (no overflow). Screenshots I reviewed: chat-desktop-light,
  chat-calendar, chat-inside-panel, chat-mobile, console-overview, studio-evaluation.
- **Front-end subagent only (not re-checked by me):** login page, chat dark mode screenshot,
  console audit/policies/transcript screens, Studio editor/playground/versions, Studio dark and mobile.
- **Main (me), static demo:** served from `/atrium-demo/` by the no-fallback server: chat with the
  vacation calendar (same plans as the back-end), cold deep link + reload on `#/console`, client-side
  payslip PDF (fonts embedded, accents intact, same figures), 390×844 (no overflow; banner was cut
  off, fixed to wrap).
- **Stale:** `docs/screenshots/chat-*.png` and `login.png` were captured before the Inter font fix
  (they render DejaVu); they are retaken in phase 8.

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
