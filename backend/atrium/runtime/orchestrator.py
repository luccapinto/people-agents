"""The Concierge orchestrator: one chat turn, end to end, as a stream of events.

guardrails(in) → route (visible agents only) → specialists / life-event playbook →
tools (validated, authorized, audited; writes become proposals) → composition →
guardrails(out) → stream → persist + audit. The text is streamed only after the output
guardrails passed: nothing unchecked reaches the screen.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from atrium.authz.identity import IdentityContext
from atrium.guardrails.injection import wrap_untrusted
from atrium.guardrails.pipeline import Evidence
from atrium.runtime import nlu
from atrium.runtime.agents import AgentSpec, life_events
from atrium.runtime.llm.base import Usage
from atrium.runtime.prompts import compose_prompt, route_tool, router_prompt, specialist_prompt
from atrium.runtime.registry import Execution, all_tools, execute
from atrium.runtime.router import RouteDecision
from atrium.runtime.tool import ToolContext
from atrium.text import fold
from atrium.tools._util import company_policies

if TYPE_CHECKING:
    from atrium.services import Services

MAX_STEPS = 5
CHUNK = 28
THIRD_PARTY_DOMAINS = [
    ("team.compensation.read", "o salário ou o holerite", ["salario", "holerite", "contracheque", "quanto ganha", "remuneracao", "plr", "13o", "pagamento"]),
    ("team.vacation.read", "as férias", ["ferias", "saldo de ferias", "folga", "licenca"]),
    ("team.time.read", "o banco de horas", ["banco de horas", "horas extras", "ponto"]),
    ("other.personal.read", "os dados pessoais", ["cpf", "endereco", "conta bancaria", "dependentes", "plano de saude", "telefone", "avaliacao de desempenho"]),
]


def ev(type_: str, **data) -> dict:
    return {"event": type_, "data": data}


@dataclass
class TurnState:
    identity: IdentityContext
    conversation_id: str
    user_text: str
    attachments: list[dict]
    usage: Usage = field(default_factory=Usage)
    evidence: Evidence = field(default_factory=Evidence)
    trace: dict = field(default_factory=lambda: {"guardrails": [], "tools": [], "route": None, "agents": []})
    cards: list[dict] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    proposals: list[dict] = field(default_factory=list)
    resolved: bool = True
    target: dict | None = None  # a colleague the policy engine already allowed (manager chain)


class Orchestrator:
    def __init__(self, services: Services, stream_delay_s: float = 0.0) -> None:
        self.s = services
        self.stream_delay_s = stream_delay_s

    # ------------------------------------------------------------------ public
    def run(self, identity: IdentityContext, conversation_id: str | None, text: str,
            attachments: list[dict] | None = None, playground: str | None = None) -> Iterator[dict]:
        identity = identity.for_request()
        conv_id, new = self.s.conversations.ensure(identity.employee_id, conversation_id, playground)
        st = TurnState(identity, conv_id, text.strip(), attachments or [])
        yield ev("message.start", conversation_id=conv_id, request_id=identity.request_id)

        limit = self.s.policy.store.value("user_rate_limit_per_minute", 12)
        if self.s.conversations.recent_user_messages(identity.employee_id) >= limit:
            yield ev("error", code="rate_limited", message="Muitas mensagens em pouco tempo. Aguarde um minuto e tente de novo.")
            return
        if self.s.conversations.tokens_today(identity.employee_id) >= self.s.policy.store.value("user_daily_token_budget", 200000):
            yield ev("error", code="budget_exceeded", message="Seu orçamento diário de uso do assistente acabou. Ele renova amanhã.")
            return

        check = self.s.guardrails.check_input(st.user_text)
        for o in check.outcomes:
            st.trace["guardrails"].append(o.as_dict())
            yield ev("trace.guardrail", **o.as_dict())
        self.s.audit.append("guardrail.input", actor=identity.employee_id, conversation=conv_id, request=identity.request_id,
                            payload={"outcomes": [o.as_dict() for o in check.outcomes if o.outcome != "pass"]})
        self.s.conversations.add(identity.employee_id, conv_id, "user", check.stored_text,
                                 {"attachments": st.attachments}, redacted=check.stored_text != st.user_text)
        if new:
            title = "Conversa sensível" if check.sensitive else (check.stored_text[:60] or "Nova conversa")
            self.s.conversations.set_title(identity.employee_id, conv_id, title, sensitive=bool(check.sensitive))

        if check.blocked:
            yield from self._finish(st, check.message, agents=[])
            return

        visible = self.s.agents.visible_for(identity, playground)
        if playground and playground not in {a.id for a in visible}:
            self.s.audit.append("authz.denied", actor=identity.employee_id, conversation=conv_id,
                                payload={"action": "studio.playground", "agent": playground})
            yield ev("error", code="agent_unavailable", message="Este agente não está disponível para você.")
            return
        if check.sensitive:
            yield from self._sensitive(st, check, visible)
            return

        third = self._third_party(st)
        if third and not third["decision"].allowed:
            yield from self._refuse_third_party(st, third)
            return
        if third and any(a.id == "leadership" for a in visible):
            st.target = {"name": third["name"], "action": third["action"]}

        if st.target:
            decision = RouteDecision("single", ["leadership"], f"Pergunta sobre {st.target['name']}, do time da pessoa autenticada.",
                                     method="subject_check")
        else:
            decision = self._route(st, visible, playground)
        names = {a.id: a.name for a in visible}
        st.trace["route"] = decision.as_dict()
        yield ev("trace.route", **decision.as_dict(), agent_names=[names.get(a, a) for a in decision.agents])
        self.s.audit.append("chat.route", actor=identity.employee_id, conversation=conv_id, request=identity.request_id,
                            payload={"mode": decision.mode, "agents": decision.agents, "method": decision.method})

        if decision.mode == "clarify":
            yield from self._finish(st, decision.clarification or "Pode detalhar um pouco mais?", agents=[],
                                    suggestions=[f"Sobre {names.get(a, a)}" for a in decision.agents])
            return

        by_id = {a.id: a for a in visible}
        if decision.mode == "life_event" and decision.life_event:
            sections = yield from self._playbook(st, decision.life_event, by_id)
            event = life_events()[decision.life_event]
            final = self._compose(st, sections, intro=event["intro"])
            yield from self._finish(st, final, agents=decision.agents)
            return

        sections = []
        for agent_id in decision.agents:
            agent = by_id.get(agent_id)
            if agent is None:  # defensive: the runtime re-checks the router output
                st.trace["guardrails"].append({"name": "route_check", "stage": "route", "outcome": "block",
                                               "detail": f"agente {agent_id} não visível"})
                continue
            answer = yield from self._specialist(st, agent)
            sections.append((agent.name, answer))
        final = sections[0][1] if len(sections) == 1 else self._compose(st, sections)
        yield from self._finish(st, final, agents=decision.agents)

    # ------------------------------------------------------------------ routing
    def _route(self, st: TurnState, visible: list[AgentSpec], playground: str | None) -> RouteDecision:
        if playground:
            return RouteDecision("single", [playground], "Modo playground do Agent Studio: agente fixo.", method="playground")
        ids = [a.id for a in visible]
        messages = [{"role": "system", "content": router_prompt(visible, st.identity, self._today())},
                    *self.s.conversations.history(st.identity.employee_id, st.conversation_id, limit=4)[:-1],
                    {"role": "user", "content": st.user_text}]
        c = self.s.llm.complete(messages, [route_tool(ids)], max_tokens=200, purpose="route",
                                tool_choice={"type": "function", "function": {"name": "route_request"}},
                                context={"user_text": st.user_text, "profiles": [a.profile() for a in visible],
                                         "life_events": life_events(), "today": self._today().isoformat()})
        st.usage.add(c)
        call = next((t for t in c.tool_calls if t.name == "route_request"), None)
        if call is None:
            return RouteDecision("direct", ["concierge"], "Roteador não decidiu; Concierge responde.", method=self.s.llm.name)
        args = call.arguments
        agents = [a for a in args.get("agents", []) if a in ids][:3] or ["concierge"]
        mode = args.get("mode", "single")
        event = args.get("life_event")
        method = "lexical" if self.s.llm.name == "fake" else "llm"
        if event and event != "none" and event in life_events():
            return RouteDecision("life_event", agents, args.get("reason", ""), method=method, life_event=event)
        if mode == "multi" and len(agents) < 2:
            mode = "single"
        if agents == ["concierge"]:
            mode = "direct"
        return RouteDecision(mode, agents, args.get("reason", ""), method=method, scores=args.get("scores", {}),
                             clarification=args.get("clarification") or None)

    # ------------------------------------------------------------------ third-party subjects
    def _third_party(self, st: TurnState) -> dict | None:
        """Someone else's personal data asked by name? The policy engine decides, before any model call."""
        f = fold(st.user_text)
        domain = next(((action, label) for action, label, words in THIRD_PARTY_DOMAINS
                       if any(nlu.contains_phrase(f, w) for w in words)), None)
        if domain is None:
            return None
        names = self.s._directory()
        firsts: dict[str, list[str]] = {}
        for eid, name in names.items():
            firsts.setdefault(fold(name.split()[0]), []).append(eid)
        person = next((eid for eid, name in names.items() if fold(name) in f and eid != st.identity.employee_id), None)
        if person is None:
            for token in set(nlu.WORD.findall(f)):
                ids = firsts.get(token, [])
                if len(ids) == 1 and ids[0] != st.identity.employee_id and token.capitalize() in st.user_text:
                    person = ids[0]
                    break
        if person is None:
            return None
        action, label = domain
        decision = self.s.policy.authorize(st.identity, action, person)
        return {"subject": person, "name": names[person], "action": action, "label": label, "decision": decision}

    def _refuse_third_party(self, st: TurnState, third: dict):
        d = third["decision"]
        trace = {"subject": third["subject"], "subject_name": third["name"], "action": third["action"], "decision": d.as_dict()}
        st.trace["authz"] = trace
        yield ev("trace.authz", **trace)
        self.s.audit.append("authz.denied", actor=st.identity.employee_id, subject=third["subject"], conversation=st.conversation_id,
                            request=st.identity.request_id, payload={"action": third["action"], "decision": d.as_dict(),
                                                                     "stage": "subject_check"})
        st.evidence.authorized_people.discard(third["name"])
        if third["action"] == "team.compensation.read" and st.identity.is_manager and third["subject"] in st.identity.chain_reports:
            why = "Pela política de governança vigente, gestores não veem salário nem holerite do time."
        elif third["action"] == "team.compensation.read":
            why = "Remuneração é um dado individual e confidencial: só a própria pessoa tem acesso."
        elif third["action"] == "other.personal.read":
            why = "Dados cadastrais e de benefícios são individuais: só a própria pessoa tem acesso."
        else:
            why = "Esse dado só é visível para a própria pessoa e para a liderança dela."
        text = (f"Não posso mostrar {third['label']} de {third['name']}. {why} "
                "Essa regra é aplicada pelo sistema, não por mim, e vale para qualquer pedido. Posso ajudar com os seus próprios dados?")
        yield from self._finish(st, text, agents=[])

    def _today(self) -> date:
        from atrium.clock import today

        return today()

    # ------------------------------------------------------------------ specialists
    def _specialist(self, st: TurnState, agent: AgentSpec):
        yield ev("agent.start", agent_id=agent.id, agent_name=agent.name)
        st.trace["agents"].append(agent.id)
        tools = all_tools()
        allowed = [n for n in agent.tools if n in tools and (not tools[n].roles or tools[n].roles & st.identity.roles)]
        schemas = [tools[n].schema() for n in allowed]
        note = ""
        if st.attachments:
            note = "\n\nArquivos enviados nesta mensagem: " + "; ".join(f"{a['filename']} (upload_id={a['upload_id']})" for a in st.attachments)
        messages = [{"role": "system", "content": specialist_prompt(agent, st.identity, self._today())},
                    *self.s.conversations.history(st.identity.employee_id, st.conversation_id, limit=6)[:-1],
                    {"role": "user", "content": st.user_text + note}]
        ctx = ToolContext(identity=st.identity, services=self.s, agent_id=agent.id, conversation_id=st.conversation_id)
        context = {"user_text": st.user_text, "today": self._today().isoformat(), "attachments": st.attachments,
                   "first_name": st.identity.first_name, "target": st.target}
        summaries: list[str] = []
        executions: list[Execution] = []
        for _step in range(MAX_STEPS):
            c = self.s.llm.complete(messages, schemas or None, max_tokens=self.s.settings.llm_max_tokens, purpose="specialist",
                                    context=context)
            st.usage.add(c)
            if not c.tool_calls:
                answer = c.content.strip()
                break
            messages.append({"role": "assistant", "content": c.content or None, "tool_calls": [
                {"id": t.id, "type": "function", "function": {"name": t.name, "arguments": json.dumps(t.arguments, ensure_ascii=False)}}
                for t in c.tool_calls]})
            for call in c.tool_calls:
                ctx.subject_id = None
                ex = execute(ctx, call.name, call.arguments, set(allowed))
                executions.append(ex)
                payload = yield from self._emit_execution(st, ctx, agent, ex)
                summaries.append(ex.result.summary)
                messages.append({"role": "tool", "tool_call_id": call.id,
                                 "content": wrap_untrusted(f"tool:{call.name}", json.dumps(payload, ensure_ascii=False, default=str))})
        else:
            answer = " ".join(summaries)
        if not answer:
            answer = " ".join(summaries) or "Não consegui concluir agora."
        if executions and all(e.status in ("error", "denied", "invalid") for e in executions) and \
                all(e.tool.name == "kb_search" for e in executions):
            st.resolved = False
            self.s.conversations.record_unanswered(st.identity.employee_id, agent.id, st.user_text)
        return answer

    def _emit_execution(self, st: TurnState, ctx: ToolContext, agent: AgentSpec, ex: Execution):
        trace = ex.trace() | {"agent_id": agent.id}
        st.trace["tools"].append(trace)
        yield ev("trace.tool", **trace)
        r = ex.result
        st.evidence.texts.append(r.summary)
        st.evidence.texts.append(json.dumps(r.data, ensure_ascii=False, default=str))
        if ex.decision.allowed and ctx.subject_id:
            person = self.s.directory_name(ctx.subject_id)
            if person:
                st.evidence.authorized_people.add(person)
        if r.card:
            card = r.card.as_dict() | {"agent_id": agent.id}
            st.cards.append(card)
            yield ev("card", agent_id=agent.id, card=r.card.as_dict())
        for cit in r.citations:
            if all(c["id"] != cit.id for c in st.citations):
                st.citations.append(cit.as_dict())
                st.evidence.texts.append(cit.snippet)
                yield ev("citation", **cit.as_dict())
        payload = {"ok": r.error is None and ex.status != "denied", "summary": r.summary, "data": r.data}
        if r.proposal and ex.status == "proposal":
            target = all_tools()[r.proposal.tool or ex.tool.name]
            p = self.s.proposals.create(ctx, target, r.proposal)
            public = {k: v for k, v in p.items() if k != "token"}
            st.proposals.append(public)
            yield ev("proposal", **p)
            payload["proposal_status"] = "awaiting_user_confirmation"
            payload["note"] = "Proposta criada. Só a pessoa pode confirmar, no cartão; não diga que a ação foi concluída."
        return payload

    def _playbook(self, st: TurnState, event_key: str, by_id: dict[str, AgentSpec]):
        event = life_events()[event_key]
        dates = nlu.parse_dates(st.user_text, self._today())
        event_date = (dates[0] if dates else self._today()).isoformat()
        sections: dict[str, list[str]] = {}
        order: list[str] = []
        for step in event["steps"]:
            agent = by_id.get(step["agent"])
            if agent is None or step["tool"] not in agent.tools:
                continue
            if agent.id not in sections:
                sections[agent.id] = []
                order.append(agent.id)
                yield ev("agent.start", agent_id=agent.id, agent_name=agent.name)
                st.trace["agents"].append(agent.id)
            args = {k: (v.replace("{event_date}", event_date) if isinstance(v, str) else v) for k, v in step["args"].items()}
            ctx = ToolContext(identity=st.identity, services=self.s, agent_id=agent.id, conversation_id=st.conversation_id)
            ex = execute(ctx, step["tool"], args, set(agent.tools))
            yield from self._emit_execution(st, ctx, agent, ex)
            sections[agent.id].append(ex.result.summary)
        card = {"type": "life_event", "data": {"event": event_key, "title": event["title"], "date": event_date,
                                                "steps": [{"agent": by_id[a].name, "summaries": sections[a]} for a in order]}}
        st.cards.insert(0, card)
        yield ev("card", agent_id="concierge", card=card)
        return [(by_id[a].name, " ".join(sections[a])) for a in order]

    def _compose(self, st: TurnState, sections: list[tuple[str, str]], intro: str | None = None) -> str:
        body = "\n\n".join(f"[{name}]\n{text}" for name, text in sections)
        c = self.s.llm.complete([{"role": "system", "content": compose_prompt(st.identity)},
                                 {"role": "user", "content": f"Pergunta: {st.user_text}\n\n{body}"}],
                                None, max_tokens=self.s.settings.llm_max_tokens, purpose="compose",
                                context={"sections": sections, "intro": intro})
        st.usage.add(c)
        return c.content.strip() or body

    def _sensitive(self, st: TurnState, check, visible: list[AgentSpec]):
        """Sensitive topics: no model call, nothing stored beyond the category, official channels."""
        decision = RouteDecision("sensitive", ["compliance"], f"Tema sensível ({check.sensitive}): encaminhamento humano com cuidado.",
                                 method="guardrail")
        st.trace["route"] = decision.as_dict()
        yield ev("trace.route", **decision.as_dict(), agent_names=["Políticas e Compliance"])
        agent = next((a for a in visible if a.id == "compliance"), None)
        if agent:
            ctx = ToolContext(identity=st.identity, services=self.s, agent_id="compliance", conversation_id=st.conversation_id)
            yield ev("agent.start", agent_id="compliance", agent_name=agent.name)
            ex = execute(ctx, "compliance_support_channels", {}, set(agent.tools))
            yield from self._emit_execution(st, ctx, agent, ex)
        c = company_policies()["compliance"]
        if check.high_risk:
            text = (f"Sinto muito que você esteja passando por isso. Se você está em risco agora, ligue 188 (CVV, 24 horas, gratuito) "
                    f"ou 192 (SAMU). O {c['support_program']['name']} também atende 24h pelo {c['support_program']['phone']}, "
                    "com sigilo. Você não precisa passar por isso sozinho(a).")
        elif check.sensitive == "saúde mental":
            text = (f"Obrigado por compartilhar. Cuidar da saúde mental é importante, e você não precisa resolver isso sozinho(a). "
                    f"O {c['support_program']['name']} oferece apoio psicológico gratuito e confidencial, 24h, pelo "
                    f"{c['support_program']['phone']}. Não guardei os detalhes desta mensagem.")
        else:
            text = (f"Sinto muito pelo que aconteceu. Esse tipo de situação deve ser tratado pelo {c['ethics_channel']['name']}, "
                    f"que é sigiloso, aceita relatos anônimos e protege contra retaliação: {c['ethics_channel']['url']} ou "
                    f"{c['ethics_channel']['phone']}. Eu não investigo nem registro os detalhes do relato aqui.")
        self.s.audit.append("chat.sensitive", actor=st.identity.employee_id, conversation=st.conversation_id,
                            payload={"category": check.sensitive, "high_risk": check.high_risk})
        yield from self._finish(st, text, agents=["compliance"], sensitive=True)

    # ------------------------------------------------------------------ finish
    def _finish(self, st: TurnState, text: str, agents: list[str], suggestions: list[str] | None = None, sensitive: bool = False):
        out = self.s.guardrails.check_output(text, st.evidence, st.identity.name)
        for o in out.outcomes:
            st.trace["guardrails"].append(o.as_dict())
            yield ev("trace.guardrail", **o.as_dict())
        if out.blocked:
            self.s.audit.append("guardrail.output_blocked", actor=st.identity.employee_id, conversation=st.conversation_id,
                                payload={"outcomes": [o.as_dict() for o in out.outcomes]})
        final = out.text
        for i in range(0, len(final), CHUNK):
            yield ev("text.delta", delta=final[i:i + CHUNK])
            if self.stream_delay_s:
                time.sleep(self.stream_delay_s)
        if suggestions:
            yield ev("suggestions", items=suggestions)
        usage = st.usage.as_dict()
        yield ev("usage", **usage)
        payload = {"trace": st.trace, "cards": st.cards, "citations": st.citations, "proposals": st.proposals, "usage": usage,
                   "agents": agents, "suggestions": suggestions or []}
        stored = "[resposta de encaminhamento sensível]" if sensitive else final
        mid = self.s.conversations.add(st.identity.employee_id, st.conversation_id, "assistant", stored, payload)
        self.s.conversations.record_usage(st.identity.employee_id, st.identity.unit_id, st.conversation_id, agents, usage, st.resolved)
        self.s.audit.append("chat.turn", actor=st.identity.employee_id, conversation=st.conversation_id, request=st.identity.request_id,
                            payload={"agents": agents, "tools": [t["tool"] + ":" + t["status"] for t in st.trace["tools"]],
                                     "usage": usage, "message": mid})
        yield ev("message.end", message_id=mid, resolved=st.resolved)
