# ADR 0010: Static demo with a TypeScript engine checked by goldens

Status: accepted (2026-09-30)

## Context
The demo must run on GitHub Pages without a back-end, with the same isolation guarantees.

## Decision
Port the calculators, policy engine, tools, lexical router and guardrails to TypeScript
(`frontend/src/demo/`). The Python implementation generates `shared/generated/dataset.json`
and `shared/generated/goldens.json` (tool outputs per persona, routing decisions,
authorization decisions). Vitest asserts the TypeScript engine reproduces them.

## Alternatives rejected
- Pyodide running the Python back-end in the browser: single implementation, but 10+ MB of WebAssembly, slow start on phones, fragile on WebKit.
- Recorded replays: cheap but free text and persona isolation would be fake.
