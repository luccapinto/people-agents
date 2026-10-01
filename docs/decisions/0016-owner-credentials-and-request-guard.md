# ADR 0016: Owner credentials only in a one-shot container; column guard on requests

Status: accepted (2026-10-01)

## Context
Two places where the "defense in depth" claim of the security model was weaker than written:

- The compose `api` container migrated and seeded on start, so the serving process carried
  `ATRIUM_OWNER_DATABASE_URL` in its environment. A remote-code-execution or SSRF-style bug
  in the API would have exposed a role that owns every table and is not bound by RLS.
- RLS on `hr.vacation_requests`, `hr.leave_requests` and `hr.time_adjustments` lets the
  requester and any manager in the chain `UPDATE` the row (cancel, decide). Policies select
  rows; they cannot restrict columns or values, so the database alone would have let an
  employee set `status = 'approved'` on their own request, and a skip-level manager decide a
  request the policy engine reserves for the direct manager. Only application code prevented it.

## Decision
- Compose runs migrations and the first-start seed in a one-shot `migrate` service
  (`atrium seed --if-empty`, same image). `api` depends on it with
  `service_completed_successfully` and receives only the `atrium_app` URL. The image `CMD`
  serves only.
  The owner URL is not part of the serving `Settings` either: only `MaintenanceSettings`,
  built by the `seed`, `db-reset` and `purge` commands, reads `ATRIUM_OWNER_DATABASE_URL`, so
  the API process holds no owner connection string, not even the development default.
- Migration `0003` adds `hr.guard_request_update()`, a `BEFORE UPDATE` trigger on the three
  request tables. With an identity set (`app.employee_id`), it refuses moving a request to
  another employee and changing anything but `status` and the decision fields. The requester
  may only cancel and cannot record a decision. Anyone else must be the requester's direct
  manager, the same rule as the policy engine's `direct_report` for `team.vacation.decide`.
  Without an identity (owner maintenance) it allows the update.
- Policy decisions name the actual reason: a non-manager asking for a colleague's individual
  data is denied as `personal_data_owner`, not `manager_chain`.

## Alternatives rejected
- Column-level `GRANT UPDATE (status, ...)`: it cannot tell the requester from the manager, so
  it still allows self-approval.
- Separate RLS policies per actor: `USING` sees the old row and `WITH CHECK` the new one, but
  never both at once, so no policy can express "only this transition".
