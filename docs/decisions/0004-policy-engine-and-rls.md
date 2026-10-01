# ADR 0004: Policy engine in code plus Postgres RLS

Status: accepted (2026-09-30)

## Context
Authorization must be deterministic, testable and independent from the model, and a bug in
a repository query must not leak rows.

## Decision
- A Python policy engine decides every tool call (`authorize(ctx, action, subject)`), with configurable switches stored in `app.policies`.
- Postgres row-level security on every personal-data table. The only session input is `app.employee_id` (`SET LOCAL`). Chain of command, HRBP coverage and policy switches are derived inside the database by `SECURITY DEFINER` helper functions with a fixed `search_path`.
- The API connects as `atrium_app` without `BYPASSRLS` and owns no table (tables belong to `atrium_owner`, used only by migrations and the seed), so RLS always applies to it. `FORCE ROW LEVEL SECURITY` is not used because the owner must load the system-of-record data.

## Alternatives rejected
- OPA/Cedar: excellent, but an extra service for a reference project. The engine interface allows swapping later.
- Passing roles as session variables: a buggy caller could escalate by setting them.
