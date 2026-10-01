# STATUS

Single source of truth for where the build is.

**Current phase:** round 3 (the demo without a model understands real people) — done. All work
committed on `main`; servers and containers torn down.

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

## Measured (last run, round 3)

| Check | Result |
|---|---|
| `make test` — back-end (pytest, deterministic model, hash embeddings) | 326 passed, 5 live tests deselected |
| `make test` — front-end (Vitest: unit + demo parity) | 708 passed in 24 files (parity: 617) |
| e2e real app (Playwright, Chromium) against the compose production build on a fresh volume | 14/14 |
| e2e static demo under `/atrium-demo/`, no-SPA-fallback server (`make e2e-demo`) | 28/28 (Chromium 14, WebKit 14) |
| Owner phrases (`owner-phrases.yaml`, 28 phrases: 20 owner + 8 visitor) | 26/26 test cases in the back-end and in the demo engine |
| Routing, 64 paraphrases (`routing.yaml`, used for tuning) | **59/64 = 92.2%** (floor 92%) |
| Routing, blind set (`routing-blind.yaml`, 40, frozen before round 2) | **34/40 = 85.0%** (round 2: 28/40; floor 85%) |
| Routing, blind set 2 (`routing-blind-2.yaml`, 68, frozen at the start of round 3 in `156b573`) | **61/68 = 89.7%** (baseline with the round-2 router: 53/68; floor 85%) |
| Subject before intent (`subject.yaml`: questions about someone else, allowed scopes, "about me") | 30/30 refused without the speaker's data, 3/3 allowed, 8/8 own data (PT and EN), both engines |
| Injection (`injection.yaml`, 22 PT/EN/ES) / benign look-alikes (`injection-benign.yaml`, 17) | 22/22 blocked before any model or tool / 0/17 blocked; no shipped knowledge chunk matches a pattern; verdicts identical in both engines |
| Out-of-domain questions (`out-of-domain.yaml`, 14) | 0 citations in every knowledge-base set, both engines |
| Knowledge answers (`retrieval.yaml`, 20) | each from the expected document, an equally valid one, or an honest refusal where no document covers it |
| Goldens (`make goldens`) | regenerated twice, byte-identical; one knowledge turn changed (the citation fix kept a sentence the split had pushed out) |
| Static demo bundle (js, css, json, html; gzip -9) | before (`5a8e2fe`): 876 KiB gzip, 3,384 KiB raw; after: 1,053 KiB gzip, 4,160 KiB raw. The difference is the intent model (167 KiB gzip, its own chunk, loaded on demand) and ~10 KiB of engine code |
| LLM spend this round | US$ 0.2058: US$ 0.205 in the training-set generation run that was killed before writing anything (reasoning on by default), US$ 0.0006 in one calibration call. Over the US$ 0.20 cap by US$ 0.0058; nothing spent after that |

Total spend on real models so far: US$ 0.2276 (0.01716 + 0.0046 + 0.2058).

How often the blind sets were looked at: `routing-blind.yaml` had its misses seen twice in round 2;
in round 3 its misses were never shown, and its total was measured once after the router was frozen
(`9cabe03`, recorded in `8d12aac`). `routing-blind-2.yaml` had its total seen twice before the
freeze (the baseline, before and after rewriting the 11 phrases the overlap guard flagged) and once
after; its misses were never shown. Every later `make test` prints the same two totals (the router
has not changed since the freeze) and never the misses (`ATRIUM_SHOW_BLIND_MISSES=1` shows them).
The grammar that trains the classifier was written by someone who had seen both blind sets, so these
numbers are an upper bound despite the guard; the owner's hidden battery is the real test.

Remaining misses on the 64 (demo and tests; a real model routes in production): "nao registrei
minha entrada hoje cedo, cheguei 9h" → asks onboarding or timekeeping; "o banco pediu um papel
provando que eu trabalho ai" → compliance; "abri conta num banco novo e quero receber o salario
nela" → payroll; "como a empresa trata meus dados pessoais segundo a lei?" → profile; "o que da pra
resolver por aqui?" → asks compliance or data_platform.

## Round 3 (ADR 0017)

- **Subject before intent.** Both engines decide whose data a message asks for (a named colleague,
  "meu gestor", the team, a group, everyone) before routing; the policy engine decides, and a
  self-service tool refuses to run when the subject is not the speaker (`subject_mismatch`). Team
  pay follows `manager_can_view_team_compensation`, group and aggregate pay are refused with the
  reason. Por dentro shows whose data it was.
- **Router.** A light classifier (hashed words, pairs and character n-grams, integer weights,
  bit-identical in Python and the browser) blended with the agent profiles; deterministic rules stay
  on top. Low confidence offers questions from the probable domain only. Personal data comes before
  the knowledge base.
- **No dead ends.** Every "não encontrei" offers 2–3 answerable questions plus an HR ticket; a month
  with no valid vacation window says why and shows the three nearest windows on the calendar card; a
  manager decides by first name (chips when ambiguous); the governance agent answers Carlos in the
  chat with cards and a link to the console tab.
- **Found while looking at the screens and fixed:** catalog agents read "risco baixo" with write
  tools; "Posso vender 10 dias de férias?" was answered with the absences table (a retrieval tie went
  to document order); excerpts cut "(CLT, art. 143)." in half; the receipt card repeated the policy
  note; Studio metrics showed "+0 / −0" with no window; the evaluation tab told a published version
  to go to review.

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
- **Me, round 3, real app on a fresh compose volume before any e2e run (no test agents), every
  app screenshot retaken and viewed:** landing, life event, calendar, client lunch outside a trip
  (the card repeated the policy note: fixed), "não encontrei" with chips and the HR ticket,
  injection in Por dentro, dark annual projection, phone payslip, the manager's team payroll refused
  (Por dentro left "Pessoa consultada" blank for a team: now "Dados de: o seu time"), decision by
  first name, governance in the chat (raw keys "prompt_injection bloquear: 1": now in words) and its
  link to the Políticas tab, console overview / audit / policies / transcript / phone, Studio list
  (catalog agents with write tools read "risco baixo": fixed), editor light and dark, evaluation
  (told a published version to go to review: fixed), playground ("Posso vender 10 dias de férias?"
  answered with the absences table, then with "(CLT, art." cut: both fixed), Versões (truthful "—"
  for catalog versions with no evaluation run), Métricas ("+0 / −0", no window: fixed). Static demo
  on desktop and phone from a clean browser state: 0 console errors, 0 failed requests.
- **Talos:** approved the landing and the og:image (round 2).

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

- Router generalization: the blind numbers are an upper bound (see above) and five misses remain on
  the 64; the owner's hidden battery decides. A real model routes in production and in live mode.
- The model-generated training set asked for in round 3 was not delivered: the one generation run
  spent the budget (and US$ 0.0058 more) and wrote nothing; the classifier trains on a model-free
  grammar instead (ADR 0017).
- The round-3 behaviours (subject refusals, decisions by first name, next steps, governance in the
  chat) are covered by back-end tests and the demo parity suite, not by the browser e2e suites.
- Studio rollback is covered by back-end tests (`test_studio_full_lifecycle`) but not by e2e.
- The demo accepts TXT/Markdown receipts and knowledge documents; PDF/DOCX upload needs the back-end.
- Receipt **images** are accepted but not read: there is no OCR, so only PDF/TXT receipts are
  extracted. The original ask was "comprovante (imagem/PDF)".
- The real-app e2e mutates data (a vacation request, a published Studio agent): a second run on the
  same database fails by design. `make e2e` reseeds first.
- `make goldens` and `make test` start the `atrium` compose database; with another project holding
  port 55432 they fail to start it (run `uv run atrium goldens` against the running database).
- MCP exposure of the tool catalog (P1) and the EN translation (P1) were not built.
