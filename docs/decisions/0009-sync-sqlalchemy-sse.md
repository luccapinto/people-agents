# ADR 0009: Synchronous SQLAlchemy and SSE streaming

Status: accepted (2026-09-30)

## Context
Concurrency needs are modest; clarity of transaction scope matters more (RLS uses
transaction-local settings).

## Decision
SQLAlchemy 2 with psycopg 3 in synchronous mode. FastAPI runs handlers in its thread pool;
chat responses are `StreamingResponse` over a generator yielding SSE frames. Each tool call
opens its own short RLS-scoped transaction.

## Alternatives rejected
- Async SQLAlchemy + asyncpg: more moving parts for no measurable gain at this scale.
- WebSockets: SSE is simpler, proxy friendly and enough for server-to-client streaming.
