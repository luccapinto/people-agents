# ADR 0001: Monorepo and stack

Status: accepted (2026-09-30)

## Context
A reference project must be readable end to end by a single person. Back-end, front-end,
shared contracts, knowledge content and deployment live in one repository.

## Decision
- `backend/` Python 3.12 (FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, pytest), managed with `uv`.
- `frontend/` React + Vite + TypeScript + Tailwind, Vitest and Playwright.
- `shared/` holds language-neutral contracts (catalog YAML, eval sets, test vectors, generated dataset and goldens).
- `deploy/` holds Docker Compose with project name `atrium`.

## Alternatives rejected
- Polyrepo: harder to keep the demo engine and back-end contracts in lock step.
- Node back-end: Python has better document parsing and embedding tooling and is the lingua franca of HR analytics teams.
