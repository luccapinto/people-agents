# STATUS

Single source of truth for where the build is.

**Current phase:** round 4 (publication links and the last dead ends of the hidden battery) — done.
All work committed on `main`; servers and containers torn down. Published at
https://github.com/luccapinto/people-agents, demo at https://luccapinto.github.io/people-agents/.

## Round 4

- **Links:** `branding.json` has `repositoryUrl` and `demoUrl`; the landing and the demo footer link
  the source; the demo build writes absolute `og:image`, `og:url` and `canonical` for the published
  URL; the README shows the live demo and the CI badge under the tagline.
- **Fixed classes of the hidden battery** (cases added to `golden_scenarios.yaml` and
  `out-of-domain.yaml`, replayed by both engines; flow tests in `test_flows.py`):
  1. "quanto eu tenho guardado de férias?": a quantity the speaker holds reads the balance.
  2. "quem é meu buddy?" (or "minha madrinha"): that field in one sentence, the checklist card as
     support; the checklist also carries the probation end.
  3. Mariana has two pending requests (Tiago and Tatiane): approving either works; approving someone
     with none names who is waiting, with a chip per person and one to list the pending requests.
  4. A synthetic, deterministic 30-day usage history (302 turns, feedback, 8 content gaps, input
     guardrails, denials, two justified transcript accesses) seeds both the demo and the back-end
     (`shared/generated/usage-history.json`), marked fictional in the console and in the cost answer.
  5. A short "Contrato de Experiência" document (CLT art. 445, 90 days) in the onboarding base,
     probation phrases route to Onboarding, and the novata gets her own end date (19/12/2026).
  6. Exchange rates and news are general requests (the general-request card and live mode).
  7. "mudar para o modelo híbrido", "remoto", "presencial", "regime de trabalho" route to Políticas e
     Compliance, never to the area agent.
- **Router change and the one look:** items 5–7 added routing keywords (Onboarding, Compliance) and
  general-knowledge words; the training set did not change (repro test). The 64 stayed 59/64. Both
  blind sets were measured after all router changes: 34/40 and 61/68, the same totals; misses not
  shown. The totals were printed by two `make test` runs on the same router (the second after a fix
  to the history seed and one test only), so the same measurement was seen twice.
- **Looked at by me, static demo built for this round, clean browser state:** the landing with
  "Código-fonte" next to the fictional-company line and in the footer (`login.png`); the console of
  a fresh visit with the synthetic-history note, 302 turns, cost and feedback per agent
  (`demo-console.png`), guardrail results and content gaps (`demo-console-guardrails.png`); 0
  console errors. The built `index.html` has absolute `og:image`, `og:url` and `canonical` for
  https://luccapinto.github.io/people-agents/.
- **Not done:** the checklist card does not show the probation end (the answer and the tool data do);
  the probation-review retrieval question now cites the new document instead of the guide its
  `retrieval.yaml` entry names (hit@3 19/20, above its floor; the answer test lists it as equally valid).

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

## Measured (last run, round 4)

| Check | Result |
|---|---|
| `make test` — back-end (pytest, deterministic model, hash embeddings) | 371 passed, 5 live tests deselected |
| `make test` — front-end (Vitest: unit + demo parity) | 729 passed in 24 files |
| e2e real app (Playwright, Chromium) against the compose production build on a fresh volume | 14/14 |
| e2e static demo under `/atrium-demo/`, no-SPA-fallback server (`make e2e-demo`) | 28/28 (Chromium 14, WebKit 14) |
| Owner phrases (`owner-phrases.yaml`, 28 phrases: 20 owner + 8 visitor) | 26/26 test cases in the back-end and in the demo engine |
| Routing, 64 paraphrases (`routing.yaml`, used for tuning) | **59/64 = 92.2%** (floor 92%) |
| Routing, blind set (`routing-blind.yaml`, 40, frozen before round 2) | **34/40 = 85.0%** (round 2: 28/40; floor 85%); round 4: measured once after its router changes, same total |
| Routing, blind set 2 (`routing-blind-2.yaml`, 68, frozen at the start of round 3 in `156b573`) | **61/68 = 89.7%** (baseline with the round-2 router: 53/68; floor 85%); round 4: measured once, same total |
| Subject before intent (`subject.yaml`) | 34/34 refused without the speaker's data, 3/3 allowed for the team or group, 5/5 rules questions answered with no self-service tool, 5/5 unclear subjects asked with two chips, 14/14 "about me" (including 6 collision negatives), both engines |
| Injection (`injection.yaml`, 23 PT/EN/ES) / benign look-alikes (`injection-benign.yaml`, 23) | 23/23 blocked before any model or tool / 0/23 blocked; no shipped knowledge chunk matches a pattern; verdicts identical in both engines |
| Out-of-domain questions (`out-of-domain.yaml`, 14) | 0 citations in every knowledge-base set, both engines |
| Knowledge answers (`retrieval.yaml`, 20) | each from the expected document, an equally valid one, or an honest refusal where no document covers it |
| Goldens (`make goldens`) | regenerated three times, byte-identical; 192 turns, 64 tuning routing decisions, both blind sets as count and digest, 75 policy and 120 scope decisions (switch off and on) |
| Static demo bundle (js, css, json, html; gzip -9) | before (`5a8e2fe`): 876 KiB gzip, 3,384 KiB raw; after: 1,055 KiB gzip, 4,166 KiB raw. The difference is the intent model (167 KiB gzip, its own chunk, fetched when the demo engine starts) and ~12 KiB of engine code |
| LLM spend | round 4: none (no model call). Round 3: US$ 0.2058, US$ 0.205 in the training-set generation run that was killed before writing anything (reasoning on by default), US$ 0.0006 in one calibration call; over its US$ 0.20 cap by US$ 0.0058 |

Total spend on real models so far: US$ 0.2276 (0.01716 + 0.0046 + 0.2058).

How often the blind sets were looked at: `routing-blind.yaml` had its misses seen twice in round 2;
in round 3 its misses were never shown, and its total was measured once after the router was frozen
(`9cabe03`, recorded in `8d12aac`). `routing-blind-2.yaml` had its total seen twice before the
freeze and once after; its misses were never shown. The first look, 54/68 = 79.4%, is **invalid**
(like round 1's 98.2%): 11 of its phrases were near the catalog's routing examples, one an exact
copy ("da pra eu vender 10 dias das minhas ferias?"), each a free hit for the router; only those
were reworded, without checking how they route, and the clean baseline is 53/68 = 77.9%. Every later
`make test` prints the same two totals (the router has not changed since the freeze) and never the
misses (`ATRIUM_SHOW_BLIND_MISSES=1` shows them). The goldens no longer list blind decisions one by
one (a diff would show which flipped): each blind set is a count and a digest.

Two contaminations, both disclosed: `subject.yaml` had "como ta o banco de horas da galera?", copied
word for word from `routing-blind-2.yaml`, as an asserted dev case (replaced; a test now keeps every
dev and test eval question below Jaccard 0.6 of both blind sets). The owner's fixed phrase "Qual que
é meu saldo de férias?" has the same content words as the blind item "meu saldo de ferias", so that
blind item is not independent evidence. The grammar that trains the classifier was written by
someone who had seen both blind sets, so these numbers are an upper bound despite the guard. The
round-2 router already scored 77.9% on the new blind set against 70% on the old one, so the new set
is likely easier than the owner's hidden battery: 85% here does not show 85% there. The battery is
the real test.

Remaining misses on the 64 (demo and tests; a real model routes in production): "nao registrei
minha entrada hoje cedo, cheguei 9h" → asks onboarding or timekeeping; "o banco pediu um papel
provando que eu trabalho ai" → compliance; "abri conta num banco novo e quero receber o salario
nela" → payroll; "como a empresa trata meus dados pessoais segundo a lei?" → profile; "o que da pra
resolver por aqui?" → asks compliance or data_platform.

## Round 3 (ADR 0017)

- **Subject before intent.** Both engines decide whose data a message asks for (a named colleague,
  "meu gestor", the team, a group, everyone) before routing; the policy engine decides, and a
  self-service tool refuses to run when the subject is not the speaker (`subject_mismatch`); in such
  a turn the model is not even offered one. Team pay follows `manager_can_view_team_compensation`
  (goldens check both switch states), group and aggregate pay are refused with the reason. Por
  dentro shows whose data it was. A rules question with other people in it ("como funciona o banco
  de horas da equipe?") is answered from the knowledge base with no self-service tool; when whose
  data is unclear ("minha gestora tem quantos dias de férias?") nothing is read and two chips ask.
  Neither falls back to the speaker.
- **Router.** A light classifier (hashed words, pairs and character n-grams, integer weights,
  bit-identical in Python and the browser) blended with the agent profiles; deterministic rules stay
  on top. Low confidence offers questions from the probable domain only. Personal data comes before
  the knowledge base.
- **No dead ends.** Every "Não encontrei" (knowledge base, a name not among the direct reports, a
  name not in the directory) ends with two answerable questions plus an HR ticket; a month with no
  valid vacation window says why and shows the three nearest windows on the calendar card; a manager
  decides by first name, and two direct reports with the same first name get one chip each; the
  governance agent answers Carlos in the chat with cards and a link to the console tab.
- **Found while looking at the screens and fixed:** catalog agents read "risco baixo" with write
  tools; "Posso vender 10 dias de férias?" was answered with the absences table (a retrieval tie went
  to document order), then with the FAQ for 15 days and its "Não." (a yes/no is now kept only for
  the question its heading asks); excerpts cut "(CLT, art. 143)." in half; the receipt cards repeated
  notes (the guide card's rule now shows only when the answer leaves it out); Studio metrics showed
  "+0 / −0" with no window; the evaluation tab told a published version to go to review.
- **Found in review and fixed:** rule cues cleared a whole message ("como funciona a PLR? e quanto
  todo mundo ganhou?"); "pra/para/for" attached data to a manager ("pedi as férias pra minha chefe"
  was refused); "how much do employees get for meals?", "ponto de encontro" and "my team will make"
  read as pay or time requests; the fake model turned "as férias da Camila já foram aprovadas?" into
  an approval; a month view could hide a month's valid starts behind a long window from the month
  before; six ordinary messages were blocked as injection; the demo port had deleted a test with two
  manager phrasings (they are now in `subject.yaml`, replayed by both engines).

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
- **Me, round 3 after review, on another fresh volume:** the Studio playground ("Posso vender 10
  dias de férias?" now answers "O abono é limitado a 1/3… (CLT, art. 143)… no máximo 10", no "Não."),
  the reimbursement guide (the rule is in the answer, so the card leaves it out), the not-found
  chips, and the new unclear-subject chips ("Ver o meu saldo de férias" / "Férias da minha
  gestora", `chat-unclear.png`); the static demo's receipt card with the warning once, under
  Pendências (`demo-desktop.png`), and the same unclear-subject chips in the browser engine.
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
- Not done from review, by choice: the console SQL still lives in the FastAPI handlers instead of a
  `console.py` service shared with the governance tools (the demo has one); the injection patterns
  are still two hand-synced copies (a test compares verdicts on every eval message and corpus chunk);
  the four governance tools are not in the goldens (each engine has its own tests); the HR ticket
  takes the previous user message as its summary, not the conversation's last unanswered question
  (the unanswered table has no conversation id). The training grammar's guard (trigram rule, 0.4 on
  short blind items) and the FAQ Geral labels were left as frozen with the router: changing them
  means retraining and a second look at both blind sets.
- Studio rollback is covered by back-end tests (`test_studio_full_lifecycle`) but not by e2e.
- The demo accepts TXT/Markdown receipts and knowledge documents; PDF/DOCX upload needs the back-end.
- Receipt **images** are accepted but not read: there is no OCR, so only PDF/TXT receipts are
  extracted. The original ask was "comprovante (imagem/PDF)".
- The real-app e2e mutates data (a vacation request, a published Studio agent): a second run on the
  same database fails by design. `make e2e` reseeds first.
- `make goldens` and `make test` start the `atrium` compose database; with another project holding
  port 55432 they fail to start it (run `uv run atrium goldens` against the running database).
- MCP exposure of the tool catalog (P1) and the EN translation (P1) were not built.
