# ADR 0005: Server-side proposals for every write

Status: accepted (2026-09-30)

## Context
A model can claim "the user confirmed". The confirmation must be something only the user's
authenticated client can produce.

## Decision
Write tools return a `ToolProposal` with a random 256-bit token (hash stored). The token is
streamed to the client only. `POST /api/proposals/{id}/confirm` checks owner, token,
status, expiry and single use atomically, requires a fresh step-up for sensitive actions,
re-authorizes and executes.

## Alternatives rejected
- Asking the model to ask for confirmation: not enforceable.
- Client-only confirmation without a token: replayable and not bound to the proposal.
