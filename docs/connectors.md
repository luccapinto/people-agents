# Connecting a real HRIS

Atrium never talks to a vendor directly. Tools depend on **ports** (`backend/atrium/ports`),
and an **adapter** implements them. The reference adapter
(`backend/atrium/adapters/reference/sql.py`) reads the fictional company from Postgres.
To plug your systems, implement the same ports over their APIs and wire the gateway in
`atrium/services.py`.

## The contract every adapter must honour

1. **Act as the bound identity.** `HRGateway.session(employee_id)` returns an `HRSession`
   bound to the authenticated person. A provider must never return data the system of
   record would not show to that person. Two ways to get there:
   - **Delegated access (preferred):** exchange the user's token for a downstream token
     (OAuth 2.0 token exchange / on-behalf-of) and call the HRIS as the user. The HRIS
     enforces its own permissions; Atrium's policy engine is a second check.
   - **Service account + re-check:** if the HRIS only offers a technical account, the
     adapter must filter every response by subject and re-ask `PolicyEngine.authorize`.
     This is weaker (the service account can read everything), so keep the adapter small,
     audited and covered by tests like `tests/security/test_database_rls.py`.
2. **No token passthrough.** Do not forward the Atrium session token to third parties;
   obtain an audience-specific token for each downstream API.
3. **Subjects are explicit.** Ports take the subject id. Self-service tools always pass
   the authenticated id; manager and HR tools pass a target the policy engine already
   approved. Adapters never guess subjects from names.
4. **Writes are idempotent.** Executors run once per confirmed proposal; still, send an
   idempotency key (the proposal id) when the HRIS supports it.
5. **Return domain models** (`atrium.domain.models`), not vendor payloads. Mapping lives in
   the adapter, so tools and cards stay vendor-neutral.

## Skeleton: an HTTP adapter for vacation

```python
# atrium/adapters/acme_hris/vacation.py
from datetime import date

import httpx

from atrium.domain.models import VacationPeriod, VacationRequest


class AcmeVacation:
    """VacationProvider over a REST HRIS (OpenAPI: GET /workers/{id}/time-off-balances ...)."""

    def __init__(self, client: httpx.Client) -> None:
        self.http = client  # already carries the user's delegated token

    def periods(self, employee_id: str) -> list[VacationPeriod]:
        r = self.http.get(f"/workers/{employee_id}/time-off-balances", params={"type": "VACATION"})
        r.raise_for_status()
        return [
            VacationPeriod(
                id=b["periodId"], employee_id=employee_id,
                acquisition_start=date.fromisoformat(b["accrualStart"]),
                acquisition_end=date.fromisoformat(b["accrualEnd"]),
                concession_end=date.fromisoformat(b["useBy"]),
                entitled_days=b["entitledDays"], sold_days=b.get("soldDays", 0),
                status="open" if b["state"] == "AVAILABLE" else "accruing",
            )
            for b in r.json()["items"]
        ]

    def create_request(self, employee_id, period_id, start, days, sell_days, advance_13th, requested_at) -> VacationRequest:
        r = self.http.post(f"/workers/{employee_id}/time-off-requests", json={
            "periodId": period_id, "start": start.isoformat(), "days": days, "sellDays": sell_days,
            "advanceThirteenth": advance_13th}, headers={"Idempotency-Key": f"{employee_id}:{start}:{days}"})
        r.raise_for_status()
        return self._to_request(r.json())

    # ... requests(), requests_for(), get_request(), set_status(), create_leave(), leaves()
```

```python
# atrium/adapters/acme_hris/gateway.py
from contextlib import contextmanager

import httpx


class AcmeGateway:
    def __init__(self, base_url: str, token_exchange) -> None:
        self.base_url = base_url
        self.exchange = token_exchange  # callable(employee_id) -> downstream access token

    @contextmanager
    def session(self, employee_id: str):
        token = self.exchange(employee_id)
        with httpx.Client(base_url=self.base_url, headers={"Authorization": f"Bearer {token}"}, timeout=15) as http:
            yield AcmeSession(employee_id, http)  # exposes .vacation, .payroll, .benefits, ...
```

Then, in `atrium/services.py`, replace `SqlHRGateway(self.db)` with your gateway. Ports you do
not implement yet can keep the reference adapter or raise a clear `ToolError`.

## Mixing systems

Large companies spread data across several vendors (payroll from one, benefits from
another). An `HRSession` is just an object with one provider per domain; build it from
several clients:

```python
class MixedSession:
    def __init__(self, employee_id, payroll_client, benefits_client, directory):
        self.employee_id = employee_id
        self.directory = directory
        self.payroll = PayrollVendorAdapter(payroll_client)
        self.benefits = BenefitsVendorAdapter(benefits_client)
        ...
```

## Identity and roles

`atrium/authz/identity.py` builds the `IdentityContext` from the directory: unit, manager
chain, direct reports, HRBP coverage and platform roles. With OIDC
(`ATRIUM_OIDC_ISSUER`), the token's `email` claim is mapped to an employee; roles still come
from the system of record, never from token claims a client could influence.

## What the reference adapter adds on top: Postgres RLS

The reference build also enforces row-level security in the database it owns (see
`docs/security-model.md`). External systems have their own permission models; the
equivalent defense in depth there is delegated access plus the policy engine.

## Tests to copy

- `tests/security/test_database_rls.py`: "A cannot read B" for every port you implement.
- `tests/adapters/test_reference_adapter.py`: behaviour of each provider for the personas.
- `tests/security/test_agent_security.py`: the end-to-end adversarial suite, unchanged.
