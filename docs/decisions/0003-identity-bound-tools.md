# ADR 0003: Identity-bound tools

Status: accepted (2026-09-30)

## Context
In agents the confused deputy problem appears when the model chooses whose data a tool
reads. Prompt-level instructions do not fix it.

## Decision
Self-service tools have no subject parameter; the runtime injects the authenticated
employee. Tools that address someone else (manager, HR) take a target that the policy
engine authorizes with data from the system of record. Pydantic models use
`extra="forbid"`, so smuggled arguments fail validation.

## Alternatives rejected
- One generic tool with an `employee_id` argument checked by the policy engine: works, but every self-service call would carry an attack surface and the audit would be noisier.
- Relying on the system prompt: not a control.
