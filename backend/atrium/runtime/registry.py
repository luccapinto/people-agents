"""Tool registry: catalog metadata + Python implementations + the governed execution path."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

import yaml
from pydantic import ValidationError

from atrium.authz.policy import Decision
from atrium.config import REPO_ROOT
from atrium.runtime.tool import Args, Executor, Risk, Tool, ToolContext, ToolError, ToolResult

CATALOG_PATH = REPO_ROOT / "shared/catalog/tools.yaml"


@lru_cache(maxsize=1)
def tool_catalog() -> dict:
    return yaml.safe_load(CATALOG_PATH.read_text())


def agent_risk(tools: list[str]) -> str:
    """Any write or sensitive tool makes an agent high risk; one rule for catalog and Studio agents."""
    catalog = tool_catalog()
    return "high" if any(catalog[t]["risk"] != "read" for t in tools) else "low"


_REGISTRY: dict[str, Tool] = {}


def tool(name: str, *, params: type[Args], action: str, roles: frozenset[str] = frozenset(),
         executor: Executor | None = None) -> Callable:
    """Register a tool implementation. Title, description, risk, subject and hints come from
    the governed catalog (``shared/catalog/tools.yaml``) so the demo and the back-end agree."""
    meta = tool_catalog()[name]

    def wrap(fn):
        risk = Risk(meta["risk"])
        if risk is not Risk.READ and executor is None:
            raise TypeError(f"{name}: write/sensitive tools need an executor")
        _REGISTRY[name] = Tool(
            name=name, title=meta["title"], description=meta["description"], risk=risk, subject=meta["subject"],
            action=action, params=params, handler=fn, executor=executor, roles=roles, hints=tuple(meta.get("hints", [])),
        )
        return fn

    return wrap


def all_tools() -> dict[str, Tool]:
    import atrium.tools  # noqa: F401  (registers every tool module)

    return _REGISTRY


@dataclass
class Execution:
    tool: Tool
    args: dict
    result: ToolResult
    decision: Decision
    duration_ms: int
    status: str  # ok | denied | invalid | error | proposal

    def trace(self) -> dict:
        return {
            "tool": self.tool.name,
            "title": self.tool.title,
            "risk": self.tool.risk.value,
            "args": self.args,
            "decision": self.decision.as_dict(),
            "status": self.status,
            "duration_ms": self.duration_ms,
            "error": self.result.error,
        }


def execute(ctx: ToolContext, name: str, raw_args: dict | None, allowed: set[str]) -> Execution:
    """Validate, authorize, run and audit one tool call requested by an agent."""
    tools = all_tools()
    started = time.perf_counter()
    if name not in tools or name not in allowed:
        t = tools.get(name) or Tool(name, name, "", Risk.READ, "none", "none", Args, lambda c, a: ToolResult({}, ""))
        d = Decision(False, "agent_tool_allowlist", "Esta ferramenta não faz parte das ferramentas deste agente.")
        return _finish(ctx, t, raw_args or {}, ToolResult.fail(d.reason), d, started, "denied")
    t = tools[name]
    try:
        args = t.params.model_validate(raw_args or {})
    except ValidationError as exc:
        d = Decision(False, "schema_validation", "Argumentos inválidos para a ferramenta.")
        msg = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        return _finish(ctx, t, raw_args or {}, ToolResult.fail(f"Argumentos inválidos: {msg}"), d, started, "invalid")

    if t.roles and not (t.roles & ctx.identity.roles):
        d = Decision(False, "tool_roles", f"Ferramenta restrita a: {', '.join(sorted(t.roles))}.")
        return _finish(ctx, t, args.model_dump(mode="json"), ToolResult.fail(d.reason), d, started, "denied")

    if t.subject == "self" and ctx.turn_subject != "self":
        # The question is about someone else: the speaker's own data would answer the wrong question.
        decision = Decision(False, "subject_mismatch", "A pergunta é sobre outra pessoa ou um grupo; ferramentas de autoatendimento "
                                                        "só leem os dados de quem pergunta e não respondem a ela.")
    elif t.subject == "self":
        ctx.subject_id = ctx.identity.employee_id
        decision = ctx.services.policy.authorize(ctx.identity, t.action, ctx.subject_id)
    elif t.subject == "none":
        decision = Decision(True, "no_subject", "Ferramenta sem dado pessoal de terceiros.") if not t.roles else \
            Decision(True, "tool_roles", "Papel exigido pela ferramenta presente.")
    else:  # target: the handler resolves the colleague and calls ctx.services.policy itself
        decision = Decision(True, "deferred_to_handler", "Alvo resolvido e autorizado pela ferramenta.")

    if not decision.allowed:
        return _finish(ctx, t, args.model_dump(mode="json"), ToolResult.fail(decision.reason), decision, started, "denied")
    try:
        result = t.handler(ctx, args)
    except ToolError as exc:
        return _finish(ctx, t, args.model_dump(mode="json"), ToolResult.fail(str(exc)), decision, started, "error")
    if result.decision is not None:
        decision = result.decision
    status = "denied" if (result.decision and not result.decision.allowed) else (
        "proposal" if result.proposal else ("error" if result.error else "ok"))
    return _finish(ctx, t, args.model_dump(mode="json"), result, decision, started, status)


def _finish(ctx: ToolContext, t: Tool, args: dict, result: ToolResult, decision: Decision, started: float, status: str) -> Execution:
    ex = Execution(t, args, result, decision, int((time.perf_counter() - started) * 1000), status)
    ctx.services.audit.append(
        "tool.denied" if status == "denied" else "tool.call",
        actor=ctx.identity.employee_id,
        subject=ctx.subject_id,
        conversation=ctx.conversation_id,
        request=ctx.identity.request_id,
        payload={"agent": ctx.agent_id, "tool": t.name, "risk": t.risk.value, "args": args, "status": status,
                 "decision": decision.as_dict(), "result": result.summary[:300]},
    )
    return ex
