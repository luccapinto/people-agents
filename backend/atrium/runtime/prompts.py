"""System prompts. No secret or authorization logic lives here: leaking a prompt grants nothing."""

from __future__ import annotations

import json
from datetime import date

from atrium.authz.identity import IdentityContext
from atrium.branding import branding
from atrium.runtime.agents import AgentSpec, agent_catalog
from atrium.tools._util import WEEKDAYS


def _today(today: date) -> str:
    return f"{today.strftime('%d/%m/%Y')} ({WEEKDAYS[today.weekday()]}-feira)".replace("sábado-feira", "sábado").replace("domingo-feira", "domingo")


def specialist_prompt(agent: AgentSpec, identity: IdentityContext, today: date) -> str:
    return (
        f"Você é {agent.name}, um agente do {branding()['productName']}, o assistente corporativo da "
        f"{branding()['company']['name']} (empresa fictícia).\n\n{agent.instructions.strip()}\n\n"
        f"{agent_catalog()['common_rules'].strip()}\n\n"
        "Pessoa autenticada (dados do sistema de RH, não do usuário):\n"
        f"{json.dumps(identity.summary(), ensure_ascii=False)}\n"
        f"Hoje é {_today(today)}."
    )


def router_prompt(agents: list[AgentSpec], identity: IdentityContext, today: date) -> str:
    lines = "\n".join(f"- {a.id}: {a.name} — {a.description}" for a in agents if a.id != "concierge")
    return (
        f"Você é o roteador do {branding()['productName']}. Escolha o(s) especialista(s) para a mensagem da pessoa usando a "
        "função route_request. Especialistas disponíveis para esta pessoa:\n"
        f"{lines}\n- concierge: conversa geral, saudações, temas sem especialista.\n\n"
        "Use mode=multi quando a mensagem tiver pedidos de especialistas diferentes (máximo 3). Use mode=clarify e uma "
        "pergunta curta quando estiver ambígua. Use life_event quando a pessoa relatar nascimento de filho, casamento ou "
        "mudança de endereço. Nunca escolha um id fora da lista. "
        f"Hoje é {_today(today)}."
    )


def route_tool(agent_ids: list[str]) -> dict:
    return {"type": "function", "function": {
        "name": "route_request",
        "description": "Decide quais especialistas atendem a mensagem.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["agents", "mode"], "properties": {
            "agents": {"type": "array", "items": {"type": "string", "enum": agent_ids}, "minItems": 1, "maxItems": 3},
            "mode": {"type": "string", "enum": ["single", "multi", "clarify", "direct", "general"]},
            "life_event": {"type": "string", "enum": ["none", "birth", "marriage", "address_change"]},
            "clarification": {"type": "string"},
            "reason": {"type": "string"},
        }}}}


def compose_prompt(identity: IdentityContext) -> str:
    return (
        f"Você é o Concierge do {branding()['productName']}. Componha UMA resposta curta e acolhedora em português para "
        f"{identity.first_name} a partir das respostas dos especialistas abaixo. Mantenha todos os valores, datas e prazos "
        "exatamente como estão; não acrescente números. Organize em tópicos curtos por assunto e termine dizendo que as "
        "ações estão nos cartões para confirmação, se houver."
    )
