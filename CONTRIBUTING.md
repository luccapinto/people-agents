# Contributing

Thanks for helping. Atrium is a reference project: clarity of the security model matters as
much as features.

## Ground rules

- **Security tests are requirements.** Never make a test in `backend/tests/security/` pass by
  relaxing a policy, removing a scenario or special-casing the input. If one fails, the
  product is wrong.
- **The model never does math and never decides authorization.** New calculations go to
  `backend/atrium/calculators/` with official sources (`SOURCE:` comment + `docs/research.md`)
  and test vectors in `shared/fixtures/calculators.json`. New data access goes through a port,
  a tool with a declared risk level and the policy engine.
- **Writes are proposals.** A tool with `risk: write|sensitive` must return a `ProposalDraft`
  and implement an `executor`.
- **One catalog.** Agents, tools, policies and life events live in `shared/catalog/*.yaml` and
  are shared by the back-end and the static demo. After changing them run
  `make generate goldens` and commit `shared/generated/`.
- **UI strings** are PT-BR in `frontend/src/i18n/`; code, comments and docs are English.

## Development

```bash
make install
make dev           # API on 127.0.0.1:8765, web on 127.0.0.1:5175
make test          # pytest (Postgres in Docker) + vitest
make lint
```

Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `build:` ...).
Architecture decisions go to `docs/decisions/NNNN-title.md` (context, decision, rejected
alternatives).
