"""The Concierge orchestrator: one chat turn, end to end, as a stream of events.

guardrails(in) → route (visible agents only) → specialists / life-event playbook →
tools (validated, authorized, audited; writes become proposals) → composition →
guardrails(out) → stream → persist + audit. The text is streamed only after the output
guardrails passed: nothing unchecked reaches the screen.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from atrium.authz.identity import IdentityContext
from atrium.authz.policy import Decision
from atrium.guardrails.injection import wrap_untrusted
from atrium.guardrails.pipeline import Evidence
from atrium.runtime import nlu
from atrium.runtime.agents import AgentSpec, lexicon, life_events
from atrium.runtime.intent import intent_model
from atrium.runtime.llm.base import Usage
from atrium.runtime.prompts import compose_prompt, route_tool, router_prompt, specialist_prompt
from atrium.runtime.registry import Execution, all_tools, execute
from atrium.runtime.router import GENERAL_LABELS, LexicalRouter, RouteDecision
from atrium.runtime.subject import SubjectResolver
from atrium.runtime.tool import ToolContext
from atrium.text import fold
from atrium.tools._util import company_policies

if TYPE_CHECKING:
    from atrium.services import Services

MAX_STEPS = 5
CHUNK = 28
EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F900-\U0001F9FF\uFE0F\u200D]")
# Refusals of requests about other people: who, in the sentence, and the speaker's own data to offer instead.
SCOPE_WHO = {"team": "do seu time", "group": "de outras pessoas nem de grupos", "company": "de todo mundo"}
OWN_DATA = {"compensation": "Ver o meu holerite", "vacation": "Ver o meu saldo de férias", "time": "Ver o meu banco de horas",
            "personal": "Ver os meus dados cadastrais"}
GENERAL_ANSWER = ("Esse é um pedido de uso geral ({label}). No produto, o Concierge responde esse tipo de pedido com o modelo de "
                  "linguagem da empresa, passando pelos mesmos guardrails e pela mesma auditoria das outras conversas. Aqui não há "
                  "modelo conectado, então não vou improvisar uma resposta nem citar um documento que não trata do assunto.")


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
    subject: str = "self"  # whose data the turn asks for (runtime/subject.py); tools see it
    previous: list[str] = field(default_factory=list)  # specialists of the previous turn in this conversation
    suggestions: list[str] = field(default_factory=list)


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
        if not new:
            st.previous = self.s.conversations.last_agents(identity.employee_id, conv_id)
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

        visible = self.s.agents.visible_for(identity)
        if playground:
            draft = self.s.agents.draft_for_owner(playground, identity)
            if draft is None:  # only the author may use an agent in the playground
                self.s.audit.append("authz.denied", actor=identity.employee_id, conversation=conv_id,
                                    payload={"action": "studio.playground", "agent": playground})
                yield ev("error", code="agent_unavailable", message="Este agente não está disponível para você.")
                return
            visible = [a for a in visible if a.id != playground] + [draft]
        if check.sensitive:
            yield from self._sensitive(st, check, visible)
            return

        subject = self._subject(st)
        if subject and not subject["decision"].allowed:
            yield from self._refuse_subject(st, subject)
            return
        ids = {a.id for a in visible}
        if subject:
            st.subject = subject["kind"]
            if subject["kind"] in ("person", "manager") and "leadership" in ids:
                st.target = {"name": subject["name"], "action": subject["action"]}

        if playground:
            decision = self._route(st, visible, playground)
        elif st.target:
            decision = RouteDecision("single", ["leadership"], f"Pergunta sobre {st.target['name']}, do time da pessoa autenticada.",
                                     method="subject_check")
        elif st.subject == "team" and "leadership" in ids:
            decision = RouteDecision("single", ["leadership"], "Pergunta sobre o time da pessoa gestora.", method="subject_check")
        elif st.subject in ("group", "company") and "people_analytics" in ids:
            decision = RouteDecision("single", ["people_analytics"], "Indicador agregado de um grupo de pessoas.", method="subject_check")
        else:
            decision = self._route(st, visible, playground)
        names = {a.id: a.name for a in visible}
        st.trace["route"] = decision.as_dict()
        yield ev("trace.route", **decision.as_dict(), agent_names=[names.get(a, a) for a in decision.agents])
        self.s.audit.append("chat.route", actor=identity.employee_id, conversation=conv_id, request=identity.request_id,
                            payload={"mode": decision.mode, "agents": decision.agents, "method": decision.method})

        if decision.mode == "clarify":
            yield from self._finish(st, decision.clarification or "Pode detalhar um pouco mais?", agents=[],
                                    suggestions=decision.suggestions or [f"Sobre {names.get(a, a)}" for a in decision.agents])
            return

        by_id = {a.id: a for a in visible}
        if decision.mode == "general":
            concierge = by_id.get("concierge")
            if self.s.llm.name == "fake" or concierge is None:
                # No model connected: say so honestly instead of guessing or citing an unrelated document.
                kind = decision.general or "conhecimento geral"
                card = {"type": "general_request", "data": {"kind": kind, "label": GENERAL_LABELS.get(kind, kind)}}
                st.cards.append(card | {"agent_id": "concierge"})
                yield ev("card", agent_id="concierge", card=card)
                yield from self._finish(st, GENERAL_ANSWER.format(label=GENERAL_LABELS.get(kind, kind)), agents=["concierge"])
                return
            answer = yield from self._specialist(st, concierge, with_tools=False)
            yield from self._finish(st, answer, agents=["concierge"])
            return

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
        # Life events are explicit playbooks: detect them deterministically before asking any model.
        lexical = LexicalRouter([a.profile() for a in visible], life_events(), lexicon(), intent_model()).route(st.user_text, ids, st.previous)
        if lexical.mode == "life_event":
            lexical.method = "playbook"
            return lexical
        messages = [{"role": "system", "content": router_prompt(visible, st.identity, self._today())},
                    *self.s.conversations.history(st.identity.employee_id, st.conversation_id, limit=4)[:-1],
                    {"role": "user", "content": st.user_text}]
        c = self.s.llm.complete(messages, [route_tool(ids)], max_tokens=200, purpose="route",
                                tool_choice={"type": "function", "function": {"name": "route_request"}},
                                context={"user_text": st.user_text, "profiles": [a.profile() for a in visible],
                                         "life_events": life_events(), "lexicon": lexicon(), "previous": st.previous,
                                         "today": self._today().isoformat()})
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
        if mode == "general":
            return RouteDecision("general", ["concierge"], args.get("reason", ""), method=method,
                                 general=args.get("general") or "conhecimento geral")
        if mode == "multi" and len(agents) < 2:
            mode = "single"
        if agents == ["concierge"]:
            mode = "direct"
        return RouteDecision(mode, agents, args.get("reason", ""), method=method, scores=args.get("scores", {}),
                             clarification=args.get("clarification") or None, suggestions=list(args.get("suggestions") or []))

    # ------------------------------------------------------------------ whose data
    def _subject(self, st: TurnState) -> dict | None:
        """Someone else's personal data (a colleague, the manager, the team, a group, everyone)?
        The policy engine decides, before any model call."""
        me = st.identity
        names = self.s._directory()
        firsts: dict[str, list[str]] = {}
        for eid in sorted(me.chain_reports):
            firsts.setdefault(fold(names[eid].split()[0]), []).append(eid)
        team = {first: ids[0] for first, ids in firsts.items() if len(ids) == 1}
        found = SubjectResolver(lexicon()).resolve(st.user_text, me.employee_id, me.manager_id, me.is_manager, names, team)
        if found is None:
            return None
        if found.kind in ("person", "manager"):
            if found.person_id:
                decision, name = self.s.policy.authorize(me, found.action, found.person_id), names[found.person_id]
            else:  # a first name several colleagues share: someone else either way
                decision = Decision(False, "personal_data_owner", "Dado individual de outra pessoa: só a própria pessoa tem acesso.")
                name = found.name
            action = found.action
        else:
            decision, name, action = self.s.policy.authorize_scope(me, found.kind, found.domain), None, f"{found.kind}.{found.domain}.read"
        return {"kind": found.kind, "domain": found.domain, "subject": found.person_id, "name": name, "action": action,
                "label": found.label, "decision": decision}

    def _refuse_subject(self, st: TurnState, s: dict):
        d = s["decision"]
        trace = {"subject": s["subject"], "subject_name": s["name"], "scope": s["kind"], "action": s["action"], "decision": d.as_dict()}
        st.trace["authz"] = trace
        yield ev("trace.authz", **trace)
        self.s.audit.append("authz.denied", actor=st.identity.employee_id, subject=s["subject"], conversation=st.conversation_id,
                            request=st.identity.request_id, payload={"action": s["action"], "scope": s["kind"], "decision": d.as_dict(),
                                                                     "stage": "subject_check"})
        if s["name"]:
            st.evidence.authorized_people.discard(s["name"])
        if s["kind"] in ("person", "manager"):
            if s["action"] == "team.compensation.read" and st.identity.is_manager and s["subject"] in st.identity.chain_reports:
                why = "Pela política de governança vigente, gestores não veem salário nem holerite do time."
            elif s["action"] == "team.compensation.read":
                why = "Remuneração é um dado individual e confidencial: só a própria pessoa tem acesso."
            elif s["action"] == "other.personal.read":
                why = "Dados cadastrais e de benefícios são individuais: só a própria pessoa tem acesso."
            else:
                why = "Esse dado só é visível para a própria pessoa e para a liderança dela."
            who = f"de {s['name']}"
        else:
            why, who = d.reason, SCOPE_WHO[s["kind"]]
        text = (f"Não posso mostrar {s['label']} {who}. {why} "
                "Essa regra é aplicada pelo sistema, não por mim, e vale para qualquer pedido. Posso ajudar com os seus próprios dados?")
        chips = [OWN_DATA[s["domain"]]]
        if st.identity.is_manager:
            chips.append("Como está o meu time?")
        if st.identity.is_hrbp:
            chips.append("Qual o turnover da minha área?")
        yield from self._finish(st, text, agents=[], suggestions=chips)

    def _today(self) -> date:
        from atrium.clock import today

        return today()

    # ------------------------------------------------------------------ specialists
    def _specialist(self, st: TurnState, agent: AgentSpec, with_tools: bool = True):
        yield ev("agent.start", agent_id=agent.id, agent_name=agent.name)
        st.trace["agents"].append(agent.id)
        tools = all_tools()
        allowed = [n for n in agent.tools if n in tools and (not tools[n].roles or tools[n].roles & st.identity.roles)] if with_tools else []
        schemas = [tools[n].schema() for n in allowed]
        note = ""
        if st.attachments:
            note = "\n\nArquivos enviados nesta mensagem: " + "; ".join(f"{a['filename']} (upload_id={a['upload_id']})" for a in st.attachments)
        messages = [{"role": "system", "content": specialist_prompt(agent, st.identity, self._today())},
                    *self.s.conversations.history(st.identity.employee_id, st.conversation_id, limit=6)[:-1],
                    {"role": "user", "content": st.user_text + note}]
        ctx = ToolContext(identity=st.identity, services=self.s, agent_id=agent.id, conversation_id=st.conversation_id,
                          knowledge=tuple(agent.knowledge), turn_subject=st.subject)
        context = {"user_text": st.user_text, "today": self._today().isoformat(), "attachments": st.attachments,
                   "first_name": st.identity.first_name, "target": st.target, "lexicon": lexicon()}
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
        st.suggestions += [s for s in r.suggestions if s not in st.suggestions]
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
            ctx = ToolContext(identity=st.identity, services=self.s, agent_id=agent.id, conversation_id=st.conversation_id,
                              knowledge=tuple(agent.knowledge), turn_subject=st.subject)
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
            ctx = ToolContext(identity=st.identity, services=self.s, agent_id="compliance", conversation_id=st.conversation_id,
                              knowledge=tuple(agent.knowledge))
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
        text = EMOJI.sub("", text).replace("  ", " ").strip()  # the interface has no emojis, whatever the model says
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
        suggestions = suggestions or st.suggestions[:3]
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
