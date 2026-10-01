# STATUS

Single source of truth for where the build is.

**Current phase:** round 2 (first-visit quality of the static demo) — done. All work committed on
`main`; servers and containers torn down.

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

## Measured (last run, round 2)

| Check | Result |
|---|---|
| `make test` — back-end (pytest, deterministic model, hash embeddings) | 228 passed, 5 live tests deselected |
| `make test` — front-end (Vitest: unit + demo parity) | 440 passed in 18 files |
| e2e real app (Playwright, Chromium) against the compose production build on a fresh volume | 14/14 (3 new: landing phrase → answer, general request without a model, injection shown in Por dentro); 123 API requests, all 200 |
| e2e static demo under `/atrium-demo/`, no-SPA-fallback server (`make e2e-demo`) | 28/28 (Chromium 14, WebKit 14) |
| Owner phrases (`shared/eval/owner-phrases.yaml`, 28 phrases: 20 owner + 8 visitor, checked for agent, tools, cards, citations, proposals) | 26/26 test cases (the manager's 3-turn conversation is one case) in the back-end and in the demo engine (parity test) |
| Routing, 64 paraphrases (`routing.yaml`, used for tuning) | **59/64 = 92.2%** (floor 90%); a guard rejects catalog phrases copied from any eval question |
| Routing, blind set (`routing-blind.yaml`, 40 questions frozen before tuning) | 28/40 = 70.0% (baseline 27/40); seen twice during tuning, so a regression floor, not evidence of generalization |
| Out-of-domain questions (`out-of-domain.yaml`, 14) | 0 citations in every knowledge-base set, both engines |
| Injection (`injection.yaml`, 10 PT and EN variants) / benign look-alikes (`injection-benign.yaml`, 8) | 10/10 blocked before any model or tool, red in Por dentro / 0/8 blocked |
| Retrieval hit@3 (20 queries) | 20/20 hash + full-text; knowledge answers: 17/20 from the expected document, 2 from an equally valid one, 1 honest refusal (no document covers it) |
| Goldens (`make goldens`) | regenerated three times, byte-identical (retrieval ties are broken by document and position) |
| Live mode in the demo (visitor's own OpenRouter key, `deepseek/deepseek-v4.1-flash`), one manual run in the browser | 3 model turns (general request, vacation tools, write turned into a pending proposal) + 1 refusal decided by policy before the model: **US$ 0.0046** |
| Live smoke of the back-end (`make smoke-live`, phase 8) | 5/5; US$ 0.01716; not re-run this round |

Total spend on real models so far: US$ 0.0218 (0.01716 + 0.0046).

Remaining misses on the 64 (lexical router, tests and demo only; a real model routes in
production): "o banco pediu um papel provando que eu trabalho aí" → compliance; "abri conta num
banco novo…" → payroll; "quero mudar de área…" → data_platform; "como a empresa trata meus dados
pessoais segundo a lei?" → profile; "quem do time tá fazendo hora extra demais?" (gestora) →
timekeeping. Generalization of the lexical router to unseen phrasings is the open item.

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

- **Me, round 2, in a browser (static demo, clean state):** landing, logo, favicon (32 px) and og:image; phrase from the
  landing → vacation calendar with request chips; reimbursement guide → "Usar comprovante de
  exemplo" → fields read, hidden instruction flagged in red, proposal with Confirmar/Cancelar (it
  first listed past reimbursements: fixed); knowledge answer with a markdown table (it first showed
  one row of four: fixed); general request card (it repeated the answer: fixed); live-mode dialog,
  then four live turns with a real key; injection blocked; 390×844 with the compact privacy notice
  (75 px, no overflow); 0 console errors, 0 failed requests.
- **Me, round 2, real app on a fresh compose volume, every screenshot in `docs/screenshots/`
  retaken and viewed:** landing, life event, calendar, injection in Por dentro, reimbursement card,
  dark annual projection, phone payslip, console overview / audit (chain intact) / policies (PT-BR)
  / justified transcript access (the overlay left a 12 px strip: fixed), console on a phone, Studio
  list / editor / evaluation (seeded result read "versão undefined": fixed; a real run then failed
  the refusal case, which exposed the "salário do meu gestor" bug: fixed) / playground.
- **Talos:** approved the landing and the og:image.
- **Not looked at by me this round:** Studio in dark mode, versions and metrics tabs.

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

- Generalization of the lexical router (blind set 28/40) and the five misses above; tests and the
  demo without a key use it, a real model routes in production and in live mode.
- No ADR yet for the round-2 decisions (shared lexicon, cite-or-refuse knowledge gate, injection
  now blocking, demo live mode with the visitor's key); `docs/security-model.md` has no rows yet for
  the injection block and BYOK.
- `console-mobile.png` shows the Studio agent the e2e creates (random suffix), because it was taken
  after the e2e run on the same volume.
- Studio in dark mode and the versions/metrics tabs were not looked at this round.
- Studio rollback is covered by back-end tests (`test_studio_full_lifecycle`) but not by e2e.
- The demo accepts TXT/Markdown receipts and knowledge documents; PDF/DOCX upload needs the back-end.
- Receipt **images** are accepted but not read: there is no OCR, so only PDF/TXT receipts are
  extracted. The original ask was "comprovante (imagem/PDF)".
- The real-app e2e mutates data (a vacation request, a published Studio agent): a second run on the
  same database fails by design. `make e2e` reseeds first.
- `make goldens` and `make test` start the `atrium` compose database; with another project holding
  port 55432 they fail to start it (run `uv run atrium goldens` against the running database).
- MCP exposure of the tool catalog (P1) and the EN translation (P1) were not built.
