"""Governance tools (agent: Governança). The same data as the governance console, read in the chat
by the governance role only (tool roles plus the policy engine's governance.read), each card
linking to the console screen that shows it in full."""

from __future__ import annotations

from sqlalchemy import text

from atrium.runtime.registry import tool
from atrium.runtime.tool import Card, NoArgs, ToolContext, ToolResult
from atrium.tools._util import plural

GOVERNANCE = frozenset({"governance_admin"})
WINDOW_DAYS = 30
RECENT = 8
SECURITY_TYPES = ("tool.denied", "authz.denied", "security.alert", "guardrail.output_blocked", "guardrail.injection", "chat.sensitive")
SECURITY_LABELS = {"tool.denied": ("ferramenta negada", "ferramentas negadas"), "authz.denied": ("acesso negado", "acessos negados"),
                   "security.alert": ("alerta de segurança", "alertas de segurança"),
                   "guardrail.output_blocked": ("resposta bloqueada", "respostas bloqueadas"),
                   "guardrail.injection": ("injeção detectada", "injeções detectadas"), "chat.sensitive": ("tema sensível", "temas sensíveis")}
POLICY_LABELS = {"blocked_topics": "Tópicos bloqueados", "dlp_customer_data_mode": "Dados pessoais em massa",
                 "dlp_secrets_mode": "Segredos colados no chat", "k_anonymity_min": "Tamanho mínimo de grupo (k-anonimato)",
                 "manager_can_view_team_compensation": "Gestores veem remuneração do time", "retention_days": "Retenção de conversas (dias)",
                 "transcript_grant_minutes": "Acesso justificado a transcrições (minutos)",
                 "user_daily_token_budget": "Orçamento diário de tokens por pessoa", "user_rate_limit_per_minute": "Mensagens por minuto por pessoa"}
MODES = {"warn": "avisar", "block": "bloquear"}

GUARDRAIL_LABELS = {"pii": "dados pessoais", "dlp_secrets": "segredos", "dlp_customer_data": "dados pessoais em massa",
                    "prompt_injection": "injeção de prompt", "blocked_topics": "tópicos bloqueados", "sensitive_topics": "temas sensíveis"}
OUTCOME_LABELS = {"block": ("bloqueio", "bloqueios"), "warn": ("aviso", "avisos"), "mask": ("mascaramento", "mascaramentos")}


def _allowed(ctx: ToolContext) -> ToolResult | None:
    decision = ctx.services.policy.authorize(ctx.identity, "governance.read")
    return None if decision.allowed else ToolResult(data={}, summary=decision.reason, error=decision.reason, decision=decision)


def _link(tab: str, label: str) -> dict:
    return {"href": f"/console?tab={tab}", "label": label}


def _agent_names(c) -> dict[str, str]:
    return dict(c.execute(text("""SELECT DISTINCT ON (agent_id) agent_id, spec ->> 'name' FROM app.agent_versions
                                   ORDER BY agent_id, version DESC""")).all())


@tool("governance_usage", params=NoArgs, action="governance.read", roles=GOVERNANCE)
def governance_usage(ctx: ToolContext, _args: NoArgs) -> ToolResult:
    """Use, resolution and model cost per agent over the last 30 days."""
    if (denied := _allowed(ctx)) is not None:
        return denied
    with ctx.services.db.scoped(ctx.identity.employee_id) as c:
        rows = c.execute(text(
            """SELECT a AS agent, count(*) AS turns, count(*) FILTER (WHERE resolved) AS resolved, coalesce(sum(cost_usd), 0) AS cost,
                      coalesce(sum(prompt_tokens + completion_tokens), 0) AS tokens
               FROM app.usage, unnest(agent_ids) a WHERE ts > now() - make_interval(days => :d) GROUP BY a ORDER BY turns DESC, a"""),
            {"d": WINDOW_DAYS}).all()
        names = _agent_names(c)
    turns, cost = sum(r.turns for r in rows), sum(float(r.cost) for r in rows)
    resolved = sum(r.resolved for r in rows)
    table = [[names.get(r.agent, r.agent), r.turns, f"{round(100 * r.resolved / r.turns)}%", float(r.cost), r.tokens] for r in rows]
    data = {"title": f"Uso por agente, últimos {WINDOW_DAYS} dias", "columns": ["Agente", "Interações", "Resolvidas", "Custo (US$)", "Tokens"],
            "rows": table, "money_columns": [], "usd_columns": [3], "link": _link("overview", "Abrir a visão geral no console")}
    if not rows:
        summary = f"Nenhuma interação registrada nos últimos {WINDOW_DAYS} dias."
    else:
        top = table[0]
        usd = f"{cost:.4f}".replace(".", ",")
        summary = (f"Nos últimos {WINDOW_DAYS} dias houve {plural(turns, 'interação', 'interações')} com agentes, "
                   f"{round(100 * resolved / turns)}% resolvidas sem atendimento humano, custo de modelo de US$ {usd}. "
                   f"O agente mais usado foi {top[0]} ({plural(top[1], 'interação', 'interações')}).")
    return ToolResult(data=data, summary=summary, card=Card("table", data))


@tool("governance_guardrails", params=NoArgs, action="governance.read", roles=GOVERNANCE)
def governance_guardrails(ctx: ToolContext, _args: NoArgs) -> ToolResult:
    """Governance policies in force and how often each input guardrail fired in the last 30 days."""
    if (denied := _allowed(ctx)) is not None:
        return denied
    with ctx.services.db.scoped(ctx.identity.employee_id) as c:
        policies = c.execute(text("SELECT key, value FROM app.policies ORDER BY key")).all()
        fired = c.execute(text(
            """SELECT o ->> 'name' AS name, o ->> 'outcome' AS outcome, count(*) AS n
               FROM app.audit_events, jsonb_array_elements(payload -> 'outcomes') o
               WHERE type = 'guardrail.input' AND ts > now() - make_interval(days => :d) GROUP BY 1, 2 ORDER BY 1, 2"""),
            {"d": WINDOW_DAYS}).all()
    rows = []
    for p in policies:
        v = p.value
        value = v.get("enabled", v.get("value"))
        if isinstance(value, bool):
            shown = "ligado" if value else "desligado"
        elif isinstance(value, list):
            shown = ", ".join(value) or "nenhum"
        else:
            shown = MODES.get(value, str(value))
        rows.append([POLICY_LABELS.get(p.key, p.key), shown])
    counts = [f"{GUARDRAIL_LABELS.get(f.name, f.name)}, {plural(f.n, *OUTCOME_LABELS[f.outcome])}"
              for f in fired if f.outcome in OUTCOME_LABELS]
    data = {"title": "Políticas e guardrails em vigor", "columns": ["Política", "Valor"], "rows": rows,
            "link": _link("policies", "Abrir as políticas no console")}
    summary = (f"Estão em vigor {plural(len(rows), 'política', 'políticas')} de governança, e os guardrails de entrada "
               "(dados pessoais, segredos, injeção de prompt, temas bloqueados e sensíveis) rodam em toda mensagem. ")
    summary += (f"Nos últimos {WINDOW_DAYS} dias: {'; '.join(counts)}." if counts
                else f"Nenhum guardrail de entrada disparou nos últimos {WINDOW_DAYS} dias.")
    return ToolResult(data=data, summary=summary, card=Card("table", data))


@tool("governance_security_events", params=NoArgs, action="governance.read", roles=GOVERNANCE)
def governance_security_events(ctx: ToolContext, _args: NoArgs) -> ToolResult:
    """Security events in the audit log (counts for 30 days and the most recent ones)."""
    if (denied := _allowed(ctx)) is not None:
        return denied
    with ctx.services.db.scoped(ctx.identity.employee_id) as c:
        counts = c.execute(text(
            """SELECT type, count(*) AS n FROM app.audit_events WHERE type = ANY(:t) AND ts > now() - make_interval(days => :d)
               GROUP BY type ORDER BY n DESC, type"""), {"t": list(SECURITY_TYPES), "d": WINDOW_DAYS}).all()
        recent = c.execute(text(
            "SELECT id, ts, type, actor_id FROM app.audit_events WHERE type = ANY(:t) ORDER BY id DESC LIMIT :l"),
            {"t": list(SECURITY_TYPES), "l": RECENT}).all()
    names = ctx.services._directory()
    rows = [[r.ts.date().isoformat(), SECURITY_LABELS[r.type][0], names.get(r.actor_id, r.actor_id or "—"), f"#{r.id}"] for r in recent]
    data = {"title": "Eventos de segurança recentes", "columns": ["Data", "Evento", "Pessoa", "Registro"], "rows": rows,
            "link": _link("audit", "Abrir a trilha de auditoria no console")}
    if counts:
        summary = (f"Nos últimos {WINDOW_DAYS} dias a auditoria registrou "
                   + ", ".join(plural(r.n, *SECURITY_LABELS[r.type]) for r in counts)
                   + ". Cada evento está na trilha encadeada por hash, com quem pediu e o que foi decidido.")
    else:
        summary = f"Nenhum evento de segurança nos últimos {WINDOW_DAYS} dias."
    return ToolResult(data=data, summary=summary, card=Card("table", data))


@tool("governance_transcript_access", params=NoArgs, action="governance.read", roles=GOVERNANCE)
def governance_transcript_access(ctx: ToolContext, _args: NoArgs) -> ToolResult:
    """Justified accesses to conversation transcripts: who, when and why."""
    if (denied := _allowed(ctx)) is not None:
        return denied
    with ctx.services.db.scoped(ctx.identity.employee_id) as c:
        rows = c.execute(text(
            """SELECT ts, actor_id, payload ->> 'justification' AS why, (payload ->> 'minutes')::int AS minutes
               FROM app.audit_events WHERE type = 'transcript.access' ORDER BY id DESC LIMIT :l"""), {"l": RECENT}).all()
    names = ctx.services._directory()
    table = [[r.ts.date().isoformat(), names.get(r.actor_id, r.actor_id), r.why or "—", r.minutes] for r in rows]
    data = {"title": "Acessos justificados a transcrições", "columns": ["Data", "Quem acessou", "Justificativa", "Minutos"], "rows": table,
            "link": _link("conversations", "Abrir as conversas no console")}
    summary = (f"Há {plural(len(rows), 'acesso justificado', 'acessos justificados')} a transcrições registrados; cada um exige "
               "uma justificativa, vale por tempo limitado e fica na auditoria." if rows
               else "Nenhum acesso a transcrições foi registrado. Todo acesso exige justificativa e fica na auditoria.")
    return ToolResult(data=data, summary=summary, card=Card("table", data))
