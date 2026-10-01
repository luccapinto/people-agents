# ADR 0006: Hash-chained audit log

Status: accepted (2026-09-30)

## Context
Auditors need to know that the trail was not edited after the fact.

## Decision
`app.audit_events` is insert-only for the API role, protected by a trigger, and each row
stores `hash = sha256(prev_hash || canonical_json(payload))`. Appends take an advisory lock.
Verification recomputes the chain.

## Alternatives rejected
- External append-only store (WORM bucket, ledger database): better for production, documented as the next step; the chain format is portable.
