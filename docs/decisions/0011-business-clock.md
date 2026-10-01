# ADR 0011: Pinned business clock

Status: accepted (2026-09-30)

## Context
The fictional dataset (balances, deadlines, payslips) is consistent only around a date.

## Decision
`ATRIUM_TODAY` pins "today" for the reference deployment and the demo to 2026-10-01. A real
deployment leaves it unset and uses the system date.

## Alternatives rejected
- Regenerating the dataset relative to the current date: goldens and screenshots would drift.
