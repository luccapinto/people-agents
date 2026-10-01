# Atrium

**One governed front door to everything employees need from their company.**
A corporate chat where specialist agents answer and act on vacation, payroll, benefits,
reimbursements, time tracking, documents and more — and where each person's data is
protected *by construction*, not by prompt.

> Reference implementation over a fictional Brazilian company (Nimbus Serviços Digitais
> S.A., ~120 people, CLT rules, 2026 tax tables). Everything in the dataset is invented.

![Chat with generative cards](docs/screenshots/chat-desktop-light.png)

## Why

Employees navigate ten systems (payroll, time, benefits, vacation, HR portal, intranet)
and open tickets to ask questions. Generic chatbots cannot help with personal data, and
handing that data to an ungoverned model is not an option. Atrium replaces the navigation
with a conversation and keeps the company in control:

- **A general corporate chat** with company specialists embedded. A Concierge routes each
  request to the right specialist (or several at once for life events such as a birth).
- **Identity-bound tools.** The model never chooses whose data it reads: self-service tools
  have no subject parameter, and every other tool is authorized by a policy engine and
  enforced again by Postgres row-level security.
- **Human-confirmed actions.** Writes become proposals with a server-side, single-use token.
  Sensitive actions (bank account, plan change) also require step-up re-authentication.
- **Deterministic math.** INSS, IRRF (with the Lei 15.270/2025 reduction), 13th salary,
  vacation pay, PGBL and the vacation-window optimizer are pure functions tested against
  official worked examples. The model explains; it never calculates.
- **Governance built in:** guardrails (PII masking, DLP, blocked topics, injection
  detection, sensitive topics routed to humans, third-party leak and number-grounding
  checks), a hash-chained audit log, justified and audited transcript access, budgets
  and rate limits, and an Agent Studio with an evaluation gate and human approval.

## What is inside

| Area | Highlights |
|---|---|
| 14 agents | Concierge, Férias e Ausências, Remuneração e Folha, Benefícios, Reembolsos, Ponto, Documentos, Dados Cadastrais, Carreira, Onboarding, Liderança (managers), People Analytics (HRBPs, k-anonymity), Políticas e Compliance, and "Plataforma de Dados" (created in the Agent Studio, visible only to that unit). 43 governed tools. |
| Generative UI | 25 card types: vacation balance, calendar with the best holiday bridges, payslip with PDF, annual projection, PGBL simulation, plan comparison, receipt extraction, team table, analytics with suppression, confirmation cards... |
| "Por dentro" | Per answer: guardrails, routing, each tool call with the authorization decision and policy, proposals, usage and cost. |
| Console | Usage and cost by agent and unit, security events, guardrail outcomes, content gaps, audit log with chain verification, policies, metadata-only conversation index with justified transcript access. |
| Agent Studio | Draft → evaluation gate (routing, cited answer, refusal) → review by governance (not the author) → published, with versions, rollback, pause, playground and metrics. |
| Knowledge | 33 fictional PT-BR documents in 14 knowledge bases; heading-aware chunking; hybrid retrieval (pgvector + Portuguese full-text, reciprocal rank fusion); citations; poisoned documents quarantined. |
| Static demo | The same UI running fully in the browser (no back-end) with a TypeScript port of the engine, checked against goldens produced by the Python implementation. |

## Architecture

```mermaid
flowchart LR
  UI[React app] -- HTTP + SSE --> API[FastAPI]
  UI -. static demo .-> DE[In-browser engine]
  API --> G1[Input guardrails] --> R[Concierge router] --> S[Specialists]
  S --> T[Tool registry] --> P[Policy engine] --> A[Adapters / ports]
  T --> PR[Proposals + confirmation]
  S --> KB[Hybrid knowledge search]
  S --> G2[Output guardrails] --> AU[Hash-chained audit]
  A --> DB[(Postgres 16 + RLS + pgvector)]
  KB --> DB
```

- Back-end: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, Postgres 16 + pgvector,
  SSE, a small agent runtime over OpenAI-compatible tool calling (no framework).
- Front-end: React + Vite + TypeScript + Tailwind, self-hosted fonts, lucide icons.
- LLM: any OpenAI-compatible endpoint (OpenRouter, Azure OpenAI, vLLM, Ollama). Tests use a
  deterministic, scriptable fake model.

Routing in tests and in the static demo uses a deterministic lexical router (a real model routes
in production). On a held-out set of 64 paraphrased questions (`shared/eval/routing.yaml`, none
with token Jaccard ≥ 0.6 against any routing example) it routes **49/64 = 76.6%** correctly; the
misses are listed by `pytest tests/runtime/test_routing_eval.py -s`.

Read more: [architecture](docs/architecture.md) · [security model](docs/security-model.md) ·
[connectors](docs/connectors.md) · [agent authoring](docs/agent-authoring.md) ·
[research and sources](docs/research.md) · [decisions](docs/decisions/) · [design](docs/design.md)

## Security model in one table

| Threat | Control | Proof |
|---|---|---|
| "Show me Maria's salary" | Subject check by the policy engine before any model call; self-service tools have no subject parameter | `tests/security/test_agent_security.py` |
| Prompt injection ("you are admin now") | Structural: no tool can reach other people's data; injection flagged and audited | same |
| Model smuggles an `employee_id` | Schemas reject unknown fields (`extra="forbid"`) | same |
| Application bug forgets a filter | Postgres RLS derives scope from `app.employee_id` only | `tests/security/test_database_rls.py` |
| Model claims "I confirmed it" | Writes need a server-side token held only by the user's client; single use; step-up for sensitive | proposal tests |
| Poisoned document or receipt | Content is data; documents with instructions are quarantined; receipts parsed deterministically | KB and receipt tests |
| Insider reads transcripts | Metadata-only index; justified, time-boxed, audited grants enforced by RLS | console tests |
| Audit tampering | `sha256(prev_hash ‖ canonical event)` chain, insert-only role, trigger | `tests/security/test_audit_chain.py` |

Mapped to the OWASP Top 10 for LLM Applications in [docs/security-model.md](docs/security-model.md).

## Run it

Requirements: Docker, Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 22.

```bash
# Everything in containers (Postgres + API + web on http://127.0.0.1:5175)
docker compose -p atrium -f deploy/docker-compose.yml up --build

# Local development
make install
make dev            # Postgres, seed, API on 8765, web on 5175 (deterministic model)
make test           # back-end and front-end suites
```

Use a real model: copy `.env.example` to `.env`, set `ATRIUM_LLM_PROVIDER=openai`,
`OPENROUTER_API_KEY` (or `LLM_BASE_URL` + `LLM_API_KEY` for any OpenAI-compatible endpoint)
and `OPENROUTER_MODEL`. `make smoke-live` runs five real conversations with a cost cap.

Sign in with one of the fictional personas: Rafael (employee), Mariana (manager of 8),
Patrícia (HRBP of Technology), Carlos (AI governance admin) and Beatriz (new hire).

## Static demo (GitHub Pages)

```bash
cd frontend
VITE_BASE=/atrium/ npm run build:demo        # output in frontend/dist-demo
VITE_BASE=/atrium/ npm run preview:demo      # http://127.0.0.1:4174/atrium/ (no SPA fallback, like Pages)
npm run e2e:demo                             # Playwright, Chromium + WebKit, under /atrium-demo/
```

`.github/workflows/pages.yml` builds it with `VITE_BASE=/<repository-name>/` and publishes
to GitHub Pages (enable *Settings → Pages → Source: GitHub Actions*). The demo runs entirely
in the browser: a TypeScript port of the engine (calculators, policy engine, tools, router,
guardrails, proposals, hash-chained audit, Agent Studio) over the same fictional dataset, with
knowledge search in MiniSearch and PDFs generated with pdf-lib. Routes live in the hash
(`/<repo>/#/console`) because Pages has no SPA fallback ([ADR 0015](docs/decisions/0015-demo-hash-routing.md)).
Parity with the Python back-end is enforced by goldens: 38 chat turns, 55 routing decisions,
75 policy decisions and every calculator vector must match exactly.

## Plug in your HRIS

Tools depend on ports (`backend/atrium/ports`), never on vendors. Implement the ports over
your APIs (delegated, on-behalf-of tokens preferred) and wire them in
`backend/atrium/services.py`. See [docs/connectors.md](docs/connectors.md) for the contract
and an HTTP adapter skeleton.

## Screenshots

| | |
|---|---|
| ![Calendar](docs/screenshots/chat-calendar.png) | ![Inside view](docs/screenshots/chat-inside-panel.png) |
| ![Dark mode](docs/screenshots/chat-desktop-dark.png) | ![Mobile](docs/screenshots/chat-mobile.png) |

## Project layout

```
backend/   FastAPI app, agent runtime, tools, calculators, adapters, SQL with RLS, tests
frontend/  React app (HTTP transport and in-browser demo transport), Vitest, Playwright
shared/    agent/tool catalogs, policies, eval sets, test vectors, generated dataset and goldens
content/   fictional knowledge base (PT-BR)
deploy/    Docker Compose, Dockerfiles, nginx, Postgres init
docs/      architecture, security model, connectors, authoring, ADRs, screenshots
```

## License

Apache-2.0. The company, people, plans and documents are fictional.
