# ADR 0002: A small agent runtime instead of a framework

Status: accepted (2026-09-30)

## Context
The security properties (identity injection, proposals, audit of every authorization
decision) must be visible in a few hundred lines of code. Frameworks hide the tool loop.

## Decision
Write a lean runtime over OpenAI-compatible tool calling with explicit concepts: `Agent`,
`Tool`, `ToolRegistry`, `Orchestrator`, `Guardrail`, `IdentityContext`, `ToolProposal`,
`AuditEvent`, `LLMProvider`.

## Alternatives rejected
- LangGraph / LangChain: powerful, but the identity and confirmation semantics would be glued on top of abstractions readers must learn first.
- OpenAI Agents SDK, Semantic Kernel, CrewAI: tie the design to a vendor or to a multi-agent style we do not need.
- Our runtime stays small; adopting a framework later only requires re-implementing the `Orchestrator`.
