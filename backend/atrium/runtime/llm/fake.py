"""Deterministic, scriptable stand-in for an LLM.

It goes through exactly the same orchestration path as a real model: it answers the
routing tool call, emits tool calls for specialists (choosing tools by their catalog
hints and extracting arguments with ``atrium.runtime.nlu``), and writes the final answer
from the tools' deterministic summaries. Tests can also push scripted completions to
simulate misbehaving models (hallucinated numbers, smuggled subject ids, fake claims).
"""

from __future__ import annotations

import json
import uuid
from datetime import date

from atrium.runtime import nlu
from atrium.runtime.llm.base import Completion, ToolCall
from atrium.runtime.registry import tool_catalog
from atrium.runtime.router import LexicalRouter, RoutingProfile
from atrium.text import fold

POLICY_CUES = ["posso", "pode", "como funciona", "politica", "regra", "qual o limite", "quantos dias preciso", "e permitido",
               "o que diz", "o que acontece", "quem pode", "existe", "como peco", "como solicito", "o que fazer", "qual o padrao",
               "qual o prefixo", "como configurar", "o que e", "quando e", "quando cai", "prazo"]
SMALL_TALK = ["oi", "ola", "bom dia", "boa tarde", "boa noite", "tudo bem", "obrigado", "obrigada", "valeu", "o que voce faz",
              "quem e voce", "o que voce consegue"]
FALLBACKS = {"vacation_request": "vacation_suggest_windows", "team_decide_vacation": "team_pending_approvals",
             "team_member_vacation": "team_overview", "reimbursement_submit": "reimbursement_list",
             "vacation_cancel_request": "vacation_list_requests", "benefits_change_plan": "benefits_compare_plans",
             "time_request_adjustment": "time_get_bank", "onboarding_complete_task": "onboarding_checklist",
             "profile_update_address": "profile_get", "profile_update_bank_account": "profile_get",
             "profile_add_dependent": "profile_get", "documents_visa_letter": "kb_search", "leave_register": "kb_search",
             "benefits_enroll_newborn": "benefits_get_summary", "reimbursement_extract_receipt": "reimbursement_list"}
PLANS = {"premium": "Vitalis Premium", "plus": "Vitalis Plus", "essencial": "Vitalis Essencial", "odonto plus": "Sorriso Odonto Plus",
         "odonto basico": "Sorriso Odonto Básico"}
METRIC_WORDS = [("turnover", ["turnover", "rotatividade", "desligamento"]), ("absenteeism", ["absenteismo", "ausencia", "faltas", "atestado"]),
                ("vacation_overdue", ["ferias vencid", "ferias a vencer", "ferias vencendo"]), ("time_bank", ["banco de horas", "horas extras"]),
                ("headcount", ["headcount", "quantas pessoas", "quadro"])]


def score_tool(text: str, name: str) -> float:
    meta = tool_catalog().get(name, {})
    f = fold(text)
    s = 0.0
    for h in meta.get("hints", []):
        if nlu.contains_phrase(f, h):
            s += 2.0 + 0.5 * (len(h.split()) - 1)
    title = set(nlu.tokens(meta.get("title", "")))
    s += 0.5 * len(title & set(nlu.tokens(text)))
    return s


def select_tools(text: str, names: list[str]) -> list[str]:
    scored = sorted(((score_tool(text, n), n) for n in names if n != "kb_search"), key=lambda x: (-x[0], x[1]))
    f = fold(text)
    policy_question = any(nlu.contains_phrase(f, c) for c in POLICY_CUES)
    if not scored or scored[0][0] < 2.0:
        # Small talk gets no tool; real questions fall back to the knowledge base.
        if any(nlu.contains_phrase(f, g) for g in SMALL_TALK) and len(nlu.tokens(text)) <= 4:
            return []
        return ["kb_search"] if "kb_search" in names else []
    top = scored[0][0]
    if policy_question and top < 3.0 and "kb_search" in names:
        return ["kb_search"]
    picks = [n for s, n in scored if s >= 2.0 and s >= 0.3 * top][:3] or [scored[0][1]]
    return picks


def extract_args(name: str, text: str, today: date, attachments: list[dict], target: dict | None = None) -> dict | None:
    """Arguments for a tool from the user's words. ``None`` when a required field is missing."""
    f = fold(text)
    dates = nlu.parse_dates(text, today)
    days = nlu.parse_days(text)
    if name == "kb_search":
        return {"query": text[:300]}
    if name in ("vacation_suggest_windows",):
        return {"days": days} if days and 5 <= days <= 30 else {}
    if name == "vacation_holiday_calendar":
        y = nlu.parse_year(text)
        return {"year": y} if y else {}
    if name == "vacation_simulate":
        sell = nlu.parse_sell_days(text)
        rest_days = nlu.parse_days(nlu.SELL_RE.sub(" ", fold(text)))  # "vender 10 dias" is not the vacation length
        return {"days": rest_days if rest_days and rest_days >= 5 else 30 - sell, "sell_days": sell,
                "advance_13th": "13" in f or "decimo" in f}
    if name == "vacation_request":
        if not dates:
            return None
        start = dates[0]
        n = (dates[1] - start).days + 1 if len(dates) > 1 and dates[1] > start else days
        if not n:
            return None
        return {"start": start.isoformat(), "days": n, "sell_days": nlu.parse_sell_days(text), "advance_13th": "13" in f}
    if name == "vacation_cancel_request":
        rid = nlu.parse_request_id(text)
        return {"request_id": rid} if rid else None
    if name == "leave_register":
        kind = next((k for k in ("paternidade", "maternidade", "casamento", "luto", "adocao") if k in f), None)
        return {"kind": kind, "start": (dates[0] if dates else today).isoformat()} if kind else None
    if name == "payroll_get_payslip":
        out: dict = {"kind": "plr"} if "plr" in f else {}
        m = nlu.parse_month(text, today)
        if m:
            out["month"] = m
        return out
    if name == "payroll_annual_projection":
        return {}
    if name == "payroll_simulate_net":
        amount = nlu.parse_amount(text)
        return {"gross": amount} if amount else {}
    if name == "payroll_simulate_pgbl":
        p = nlu.parse_percent(text)
        return {"contribution_percent": p} if p is not None and p <= 12 else {}
    if name == "benefits_compare_plans":
        return {"kind": "dental" if any(w in f for w in ("odonto", "dentario", "dentista")) else "health"}
    if name == "benefits_change_plan":
        plan = next((v for k, v in PLANS.items() if k in f), None)
        return {"plan": plan} if plan else None
    if name == "benefits_enroll_newborn":
        return {"birth_date": (dates[0] if dates else today).isoformat()}
    if name in ("reimbursement_extract_receipt",):
        up = next((a["upload_id"] for a in attachments), None) or nlu.parse_uuid(text)
        return {"upload_id": up} if up else None
    if name == "reimbursement_submit":
        return None
    if name == "time_request_adjustment":
        t = nlu.parse_time(text)
        if not t:
            return None
        kind = "entrada" if "entrada" in f or "cheguei" in f else "saída"
        return {"date": (dates[0] if dates else today).isoformat(), "time": t, "kind": kind, "reason": "esqueci de registrar a marcação"}
    if name == "documents_employment_letter":
        purpose = "banco" if "banco" in f else "aluguel" if "aluguel" in f else "comprovação de vínculo"
        return {"purpose": purpose}
    if name == "documents_visa_letter":
        if len(dates) < 2:
            return None
        country = next((c for c in ("Estados Unidos", "Canadá", "Portugal", "França", "Japão", "Reino Unido", "Alemanha") if fold(c) in f), "Estados Unidos")
        return {"country": country, "start": dates[0].isoformat(), "end": dates[1].isoformat()}
    if name == "documents_income_statement":
        y = nlu.parse_year(text)
        return {"year": y} if y else {}
    if name == "onboarding_complete_task":
        import re

        m = re.search(r"\bONB-\d{2}\b", text.upper())
        return {"task_id": m.group(0)} if m else None
    if name == "team_decide_vacation":
        rid = nlu.parse_request_id(text)
        if not rid:
            return None
        return {"request_id": rid, "decision": "reject" if any(w in f for w in ("recus", "negar", "nego", "rejeit")) else "approve", "note": ""}
    if name in ("team_member_vacation", "team_member_compensation"):
        person = (target or {}).get("name") or nlu.parse_person(text)
        return {"colleague": person} if person else None
    if name == "analytics_query":
        metric = next((m for m, words in METRIC_WORDS if any(w in f for w in words)), "headcount")
        group = "tenure" if "tempo de casa" in f else "work_mode" if ("modelo de trabalho" in f or "remoto" in f) else "unit"
        return {"metric": metric, "group_by": group}
    if name == "ticket_open":
        return {"category": "Atendimento de Pessoas", "summary": text[:380]}
    if name in ("profile_update_address", "profile_update_bank_account", "profile_add_dependent"):
        return None
    return {}


class FakeProvider:
    name = "fake"
    model = "fake-deterministic"

    def __init__(self) -> None:
        self.script: list[Completion] = []

    def push(self, *completions: Completion) -> None:
        self.script.extend(completions)

    def complete(self, messages, tools=None, *, max_tokens, purpose, tool_choice=None, context=None) -> Completion:
        context = context or {}
        if self.script:
            return self.script.pop(0)
        if purpose == "route":
            return self._route(context)
        if purpose == "compose":
            return self._compose(context)
        return self._specialist(messages, tools or [], context)

    # ------------------------------------------------------------------ routing
    def _route(self, ctx: dict) -> Completion:
        profiles: list[RoutingProfile] = ctx["profiles"]
        router = LexicalRouter(profiles, ctx["life_events"])
        d = router.route(ctx["user_text"], [p.agent_id for p in profiles])
        args = {"agents": d.agents, "mode": d.mode, "life_event": d.life_event or "none", "reason": d.reason,
                "clarification": d.clarification or "", "scores": d.scores}
        return Completion(tool_calls=[ToolCall("route_0", "route_request", args)], model=self.model,
                          prompt_tokens=_count(ctx["user_text"]) + 300, completion_tokens=40)

    # ------------------------------------------------------------------ specialist
    def _specialist(self, messages: list[dict], tools: list[dict], ctx: dict) -> Completion:
        text = ctx["user_text"]
        last_user = max(i for i, m in enumerate(messages) if m["role"] == "user")
        results = [m for m in messages[last_user + 1:] if m["role"] == "tool"]
        names = [t["function"]["name"] for t in tools]
        if results:
            return Completion(content=self._answer(results, ctx), model=self.model,
                              prompt_tokens=sum(_count(m.get("content") or "") for m in messages), completion_tokens=120)
        if not names:
            return Completion(content=self._no_tool_answer(ctx), model=self.model, prompt_tokens=_count(text) + 200, completion_tokens=60)
        today = date.fromisoformat(ctx["today"])
        calls = []
        target = ctx.get("target")
        picks = select_tools(text, names)
        if target:
            targeted = {"team.vacation.read": "team_member_vacation", "team.compensation.read": "team_member_compensation",
                        "team.time.read": "team_overview"}.get(target["action"])
            if targeted in names:
                picks = [targeted]
        picks.sort(key=names.index)
        for name in picks:
            args = extract_args(name, text, today, ctx.get("attachments", []), target)
            if args is None and FALLBACKS.get(name) in names:
                fb = FALLBACKS[name]
                name, args = fb, extract_args(fb, text, today, ctx.get("attachments", []), target)
            if args is not None and all(c.name != name for c in calls):
                calls.append(ToolCall(f"call_{uuid.uuid4().hex[:8]}", name, args))
        if not calls:
            return Completion(content=self._no_tool_answer(ctx), model=self.model, prompt_tokens=_count(text) + 200, completion_tokens=60)
        return Completion(tool_calls=calls, model=self.model, prompt_tokens=sum(_count(m.get("content") or "") for m in messages),
                          completion_tokens=30 * len(calls))

    def _answer(self, results: list[dict], ctx: dict) -> str:
        parts, proposal = [], False
        for m in results:
            try:
                payload = json.loads(_strip_wrapper(m["content"]))
            except (ValueError, KeyError):
                continue
            if payload.get("summary"):
                parts.append(payload["summary"])
            proposal = proposal or payload.get("proposal_status") == "awaiting_user_confirmation"
        text = " ".join(parts) or "Não consegui obter essa informação agora."
        if proposal and "confirm" not in fold(text):
            text += " Revise os detalhes e confirme no cartão."
        return text

    def _no_tool_answer(self, ctx: dict) -> str:
        f = fold(ctx["user_text"])
        first = ctx.get("first_name", "")
        if any(nlu.contains_phrase(f, g) for g in ("oi", "ola", "bom dia", "boa tarde", "boa noite", "tudo bem")):
            return (f"Olá, {first}! Sou o assistente corporativo. Posso ajudar com férias, folha e holerite, benefícios, reembolsos, "
                    "ponto, documentos, cadastro, carreira e políticas da empresa. O que você precisa?")
        if any(nlu.contains_phrase(f, g) for g in ("obrigado", "obrigada", "valeu")):
            return "Por nada! Se precisar de mais alguma coisa, é só chamar."
        if any(nlu.contains_phrase(f, g) for g in ("o que voce faz", "quem e voce", "o que voce consegue")):
            return ("Eu sou a porta de entrada para os serviços da empresa: consulto e simulo seus dados (férias, salário, benefícios, ponto), "
                    "explico políticas com citação das fontes e preparo pedidos que você confirma. Tudo com seus dados protegidos.")
        return ("Ainda não sei responder isso com segurança. Posso abrir um chamado para o time responsável, "
                "ou você pode perguntar sobre férias, holerite, benefícios, reembolsos, ponto, documentos ou carreira.")

    # ------------------------------------------------------------------ composition
    def _compose(self, ctx: dict) -> Completion:
        sections = ctx["sections"]
        intro = ctx.get("intro") or "Reuni as respostas dos especialistas:"
        body = "\n\n".join(f"**{name}.** {text}" for name, text in sections if text)
        return Completion(content=f"{intro}\n\n{body}", model=self.model, prompt_tokens=_count(body) + 200, completion_tokens=_count(body))


def _count(text: str) -> int:
    return max(1, len(text) // 4)


def _strip_wrapper(content: str) -> str:
    if content.startswith("<untrusted_data"):
        start = content.index(">") + 1
        end = content.index("</untrusted_data>")
        return content[start:end].strip()
    return content
