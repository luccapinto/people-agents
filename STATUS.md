# STATUS

Single source of truth for where the build is.

**Current phase:** 8 — finishing (done). All phases committed on `main`; servers and containers torn down.

## Plan

| Phase | Scope | State |
|---|---|---|
| 0 | Research, architecture, security model, ADRs | done |
| 1 | Domain, fictional dataset, ports/adapters, deterministic calculators + tests | done |
| 2 | Authorization core (identity, policy engine, Postgres RLS) + adversarial suite | done |
| 3 | Agent runtime (orchestrator, specialists, tools, proposals, guardrails, audit, LLM providers, SSE API) | done |
| 4 | Knowledge base (ingestion, chunking, embeddings, hybrid search, citations, content) | done |
| 5 | Chat front-end against the real back-end | done |
| 6 | Governance console and Agent Studio | done |
| 7 | Static demo (in-browser engine, parity goldens, hash routing) and GitHub Pages workflow | done |
| 8 | README, docs, CI, compose, screenshots, e2e, live smoke test | done |

## Measured (last run)

| Check | Result |
|---|---|
| `make test` — back-end (pytest, deterministic model, hash embeddings) | 178 passed, 5 live tests deselected |
| `make test` — front-end (Vitest: unit + demo parity) | 263 passed in 11 files (parity: 25 calculator vectors, 75 policy decisions, 64 routing decisions, 38 chat turns) |
| e2e real app (Playwright, Chromium) against the compose production build (nginx) on a fresh volume | 11/11; 112 API requests, none answered 4xx/5xx |
| e2e static demo under `/atrium-demo/`, no-SPA-fallback server (`make e2e-demo`) | 22/22 (Chromium 11, WebKit 11) |
| Routing, held-out set of 64 paraphrases (lexical router used by tests and the demo) | **49/64 = 76.6%**; 15 misses listed by `pytest tests/runtime/test_routing_eval.py -s` |
| Retrieval hit@3 (20 queries) | 20/20 hash + full-text (CI); 19/20 fastembed |
| Live smoke, `deepseek/deepseek-v4.1-flash` via OpenRouter (`make smoke-live`) | 5/5 on the second run; total spend US$ 0.0172 (0.0115 + 0.0056); not re-run after ADR 0016 |
| Compose `up` on a fresh volume (images already built) | db + migrate + api + web: all healthy in 59 s; `migrate` seeded 128 people, 1,130 payslips, 14 agents, 33 docs / 466 chunks (fastembed) and exited 0; the `api` container environment has no owner URL |

An earlier routing figure (54/55 = 98.2%) was invalid: 41 of 55 questions were copies of the
router's own examples. Known misses of the lexical router: requests by id (`FER-…`) to cancel or
decide go to Reembolsos; "previdência privada" goes to Benefícios; manager phrasings without
"time/equipe" go to Férias; "deu à luz" and "mudei de apê" are not recognized as life events.
A real model routes in production; the lexical router serves tests and the static demo.

## Hardening after phase 8 (ADR 0016)

- Compose runs migrations and the seed in a one-shot `migrate` service; `api` gets only the
  `atrium_app` URL (`tests/security/test_deployment.py`, and checked with `docker inspect` and
  `/proc/1/environ` on the running container).
- Migration `0003`: `BEFORE UPDATE` guard on vacation/leave/time-adjustment requests. Raw SQL as
  `atrium_app`: self-approval refused, outside-chain manager finds no row, skip-level manager
  refused, direct manager decides, requester cancels.
- A non-manager asking for a colleague's data is now recorded as `personal_data_owner`, not
  `manager_chain` (back-end, demo engine and 12 golden decisions).
- The HTTP transport no longer sends authenticated calls while signed out (an intermittent 401
  console error had failed the Studio e2e once).

## What was looked at, and by whom

- **Me, in a browser (real app):** login; chat empty state; life event with three proposals,
  confirmation "Executado" and Por dentro with each tool decision; injection attempt with the access
  denial in Por dentro (dark mode); console overview dark and at 390×844.
- **Me, in a browser (static demo, no-fallback server):** vacation calendar with the same plans as the
  back-end; cold deep link and reload on `#/console`; client-side payslip PDF (fonts embedded, accents
  intact, same figures); 390×844 (no overflow).
- **Me, screenshots reviewed:** login, chat-desktop-light, chat-calendar, chat-inside-panel,
  chat-desktop-dark, chat-mobile (retaken after the font fix and after the mobile payslip fix,
  verified by hash), console-overview, studio-evaluation, demo-desktop, demo-mobile.
- **Front-end subagent only (not re-checked by me):** console audit / policies / transcript screens,
  Studio editor / playground / versions, Studio in dark and mobile (`console-audit.png`,
  `console-policies.png`, `console-transcript.png`, `console-mobile.png`, `studio-list.png`,
  `studio-editor.png`, `studio-playground.png`).
- **Me, after ADR 0016, fresh compose stack:** Por dentro of a refused salary question shows
  `team.compensation.read`, "negado", policy `personal_data_owner` and its PT-BR reason.

## How to run / test

```bash
make install        # uv sync + npm ci
make dev            # Postgres (127.0.0.1:55432) + seed + API (127.0.0.1:8765) + web (127.0.0.1:5175)
make test           # pytest + vitest
make e2e            # fresh seed, then Playwright against the running app (needs make dev)
make e2e-demo       # build the static demo under /atrium-demo/ and test it in Chromium + WebKit
make smoke-live     # real model, cost-capped (needs OPENROUTER_API_KEY)
docker compose -p atrium -f deploy/docker-compose.yml up --build   # everything in containers
docker compose -p atrium -f deploy/docker-compose.yml down
```

## Open items

- Studio dark/mobile and the console audit/policies/transcript screens were checked by the front-end
  subagent, not by me.
- Studio rollback is covered by back-end tests (`test_studio_full_lifecycle`) but not by e2e.
- The demo accepts TXT/Markdown receipts and knowledge documents; PDF/DOCX upload needs the back-end.
- Receipt **images** are accepted but not read: there is no OCR, so only PDF/TXT receipts are
  extracted. The original ask was "comprovante (imagem/PDF)".
- The real-app e2e mutates data (a vacation request, a published Studio agent): a second run on the
  same database fails by design. `make e2e` reseeds first.
- MCP exposure of the tool catalog (P1) and the EN translation (P1) were not built.
- The lexical router misses listed above (tests and demo only).
