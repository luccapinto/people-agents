# ADR 0007: Deterministic calculators; the model never does math

Status: accepted (2026-09-30)

## Context
Salary, taxes and vacation dates are regulated and must be exact.

## Decision
All calculations live in `atrium.calculators` as pure functions with `Decimal` and
half-up rounding to cents. Tables are versioned by validity date and cite the official
source and the date checked. The model calls the function and explains the result. The
same test vectors (`shared/fixtures/calculators.json`) run in Python and in the
TypeScript port used by the demo.

## Alternatives rejected
- Letting the model compute: forbidden by the product requirements and unreliable.
