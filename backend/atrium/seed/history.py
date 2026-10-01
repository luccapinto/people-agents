"""Synthetic usage history of the last 30 days, so the governance console and the cost tools of a
freshly opened demo (or a fresh ``make dev``) show something to govern.

``build_history`` is deterministic and writes ``shared/generated/usage-history.json``; both engines
seed from that file (``seed_history`` here, ``seedHistory`` in the demo), placing each record at
its day and minute offset before the moment of seeding. Everything is fictional and marked: usage
rows carry the model name ``historico-sintetico``, audit events carry ``synthetic: true`` and the
moment they stand for, conversations are titled "Histórico sintético". What a visitor does adds on
top. Audit events are appended at seeding time (the hash chain only grows forward); their payload
says when they would have happened.
"""

from __future__ import annotations

import json
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text

from atrium.config import REPO_ROOT

HISTORY_PATH = REPO_ROOT / "shared/generated/usage-history.json"
SEED = 20261001
DAYS = 30
MODEL = "historico-sintetico"
NAMESPACE = uuid.UUID("6f1d4a52-7f0e-4f3b-9a51-0c6c2b1d7a10")
# Relative weight of each agent in the history; role-bound agents only for people who may use them.
WEIGHTS = {"vacation": 22, "payroll": 18, "benefits": 12, "reimbursement": 10, "concierge": 9, "timekeeping": 8, "compliance": 6,
           "documents": 6, "career": 5, "profile": 4, "onboarding": 3, "data_platform": 4, "leadership": 8, "people_analytics": 4,
           "governance": 1}
GAPS = [("compliance", "Posso levar meu cachorro ao escritório nas sextas?"), ("benefits", "Tem convênio com academia em Campinas?"),
        ("concierge", "Tem estacionamento conveniado perto da sede?"), ("payroll", "Posso dividir o 13º em três parcelas?"),
        ("benefits", "A empresa paga curso de inglês?"), ("compliance", "Existe auxílio para montar o home office?"),
        ("timekeeping", "Quem aprova hora extra no sábado?"), ("career", "Existe programa de mentoria fora do meu time?")]
GUARDRAILS = ([("pii", "mask", "cpf x1")] * 6 + [("prompt_injection", "block", "override_instructions")] * 4
              + [("sensitive_topic", "warn", "categoria saúde mental: encaminhamento ao canal humano")] * 3
              + [("dlp_secrets", "block", "detectado: token de acesso")] * 2
              + [("dlp_bulk_personal_data", "warn", "4 CPFs na mesma mensagem")] * 1
              + [("blocked_topics", "block", "apostas esportivas")] * 2)
DENIALS = ["team.compensation.read"] * 3 + ["other.personal.read"] * 2 + ["team.vacation.read"]
TRANSCRIPTS = [
    ("Dúvida sobre banco de horas", "Meu banco de horas zerou do nada, o que aconteceu?",
     "Seu saldo foi compensado no fechamento do semestre, como prevê a política de jornada. Quer ver o extrato do mês?",
     "Revisão de qualidade pedida pelo comitê de IA: resposta sobre banco de horas contestada."),
    ("Reembolso de hotel", "O hotel da viagem a Recife passou do limite, vou ser reembolsado?",
     "O limite de hospedagem é de R$ 650,00 por diária; o excedente precisa de aprovação do gestor antes do envio.",
     "Apuração de reclamação formal sobre o limite de hospedagem, protocolo interno 2026-09."),
]


def _id(key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, key))


def build_history(dataset: dict) -> dict:
    rng = random.Random(SEED)
    active = [e for e in dataset["employees"] if e["status"] == "active"]
    managers = {e["manager_id"] for e in active if e["manager_id"]}
    roles: dict[str, set[str]] = {}
    for r in dataset["platform_roles"]:
        roles.setdefault(r["employee_id"], set()).add(r["role"])
    hrbps = {a["hrbp_id"] for a in dataset["hrbp_assignments"]}
    governance = sorted(e for e, rs in roles.items() if "governance_admin" in rs)

    def agents_for(e: dict) -> list[str]:
        out = [a for a in WEIGHTS if a not in ("leadership", "people_analytics", "governance", "data_platform")]
        out += ["leadership"] if e["id"] in managers else []
        out += ["people_analytics"] if e["id"] in hrbps else []
        out += ["governance"] if e["id"] in governance else []
        out += ["data_platform"] if e["unit_id"] == "U11" else []
        return out

    usage, feedback = [], []
    for day in range(DAYS - 1, 0, -1):  # yesterday back to 29 days ago: always inside the console's 30-day window
        weekday = (datetime(2026, 10, 1) - timedelta(days=day)).weekday()  # weekends are quiet
        conversations: dict[str, str] = {}
        for n in range(rng.randint(1, 3) if weekday >= 5 else rng.randint(8, 18)):
            e = rng.choice(active)
            options = agents_for(e)
            agent = rng.choices(options, weights=[WEIGHTS[a] for a in options])[0]
            prompt, completion = rng.randint(900, 2600), rng.randint(120, 480)
            conv = conversations.setdefault(e["id"], _id(f"conversation-{day}-{e['id']}"))
            resolved = rng.random() < 0.9
            usage.append({"days_ago": day, "minute": rng.randint(8 * 60, 19 * 60), "employee_id": e["id"], "unit_id": e["unit_id"],
                          "conversation_id": conv, "agent_ids": [agent], "model": MODEL, "prompt_tokens": prompt,
                          "completion_tokens": completion, "cost_usd": round(prompt * 0.27e-6 + completion * 1.1e-6, 6),
                          "resolved": resolved})
            if rng.random() < 0.18:
                feedback.append({"days_ago": day, "message_id": _id(f"message-{day}-{n}"), "employee_id": e["id"], "agent_id": agent,
                                 "rating": 1 if rng.random() < 0.8 else -1})
    unanswered = [{"days_ago": rng.randint(1, DAYS - 1), "agent_id": a, "question": q} for a, q in GAPS]
    people = [e for e in active if e["id"] not in governance]
    events = [{"days_ago": rng.randint(1, DAYS - 1), "type": "guardrail.input", "actor": rng.choice(people)["id"],
               "payload": {"outcomes": [{"name": g, "stage": "input", "outcome": o, "detail": detail}]}} for g, o, detail in GUARDRAILS]
    events += [{"days_ago": rng.randint(1, DAYS - 1), "type": "authz.denied", "actor": rng.choice(people)["id"],
                "payload": {"action": action, "decision": {"allowed": False, "policy": "personal_data_owner"}, "stage": "subject_check"}}
               for action in DENIALS]
    transcripts = []
    for k, (title, question, answer, justification) in enumerate(TRANSCRIPTS):
        owner, day = people[(k * 37) % len(people)]["id"], 12 - 7 * k
        conv = _id(f"transcript-{k}")
        transcripts.append({"conversation_id": conv, "owner_id": owner, "title": f"Histórico sintético: {title}", "days_ago": day,
                            "messages": [{"role": "user", "content": question}, {"role": "assistant", "content": answer}],
                            "grantee_id": governance[0], "justification": justification})
        events.append({"days_ago": day - 1, "type": "transcript.access", "actor": governance[0], "conversation": conv,
                       "payload": {"justification": justification, "minutes": 60}})
    events.sort(key=lambda ev: (-ev["days_ago"], ev["type"]))  # the order they stand for
    return {"note": "Histórico sintético e fictício dos últimos 30 dias, gerado de forma determinística para a demonstração.",
            "model": MODEL, "days": DAYS, "usage": usage, "feedback": feedback, "unanswered": unanswered,
            "transcripts": transcripts, "events": events}


def seed_history(owner_url: str, history: dict | None = None) -> dict:
    """Places the history before now; audit events go through app.append_audit, so the chain holds."""
    history = history or json.loads(HISTORY_PATH.read_text())
    now = datetime.now(UTC).replace(second=0, microsecond=0)

    def at(days_ago: int, minute: int = 12 * 60) -> datetime:
        return (now - timedelta(days=days_ago)).replace(hour=0, minute=0) + timedelta(minutes=minute)

    engine = create_engine(owner_url)
    with engine.begin() as c:
        c.execute(text("""INSERT INTO app.usage (ts, employee_id, unit_id, conversation_id, agent_ids, model, prompt_tokens,
                                                 completion_tokens, cost_usd, resolved)
                          VALUES (:ts, :employee_id, :unit_id, CAST(:conversation_id AS uuid), :agent_ids, :model, :prompt_tokens,
                                  :completion_tokens, :cost_usd, :resolved)"""),
                  [{**u, "ts": at(u["days_ago"], u["minute"])} for u in history["usage"]])
        c.execute(text("""INSERT INTO app.feedback (message_id, employee_id, agent_id, rating, created_at)
                          VALUES (CAST(:message_id AS uuid), :employee_id, :agent_id, :rating, :ts)"""),
                  [{**f, "ts": at(f["days_ago"])} for f in history["feedback"]])
        c.execute(text("INSERT INTO app.unanswered (agent_id, question, created_at) VALUES (:agent_id, :question, :ts)"),
                  [{**u, "ts": at(u["days_ago"])} for u in history["unanswered"]])
        for t in history["transcripts"]:
            created = at(t["days_ago"], 10 * 60)
            c.execute(text("""INSERT INTO app.conversations (id, owner_id, title, created_at, updated_at)
                              VALUES (CAST(:id AS uuid), :o, :title, :ts, :ts)"""),
                      {"id": t["conversation_id"], "o": t["owner_id"], "title": t["title"], "ts": created})
            for k, m in enumerate(t["messages"]):
                c.execute(text("""INSERT INTO app.messages (conversation_id, owner_id, role, content, created_at)
                                  VALUES (CAST(:id AS uuid), :o, :role, :content, :ts)"""),
                          {"id": t["conversation_id"], "o": t["owner_id"], "role": m["role"], "content": m["content"],
                           "ts": created + timedelta(minutes=k)})
            granted = at(t["days_ago"] - 1, 15 * 60)
            c.execute(text("""INSERT INTO app.transcript_grants (conversation_id, grantee_id, justification, created_at, expires_at)
                              VALUES (CAST(:id AS uuid), :g, :j, :ts, :exp)"""),
                      {"id": t["conversation_id"], "g": t["grantee_id"], "j": t["justification"], "ts": granted,
                       "exp": granted + timedelta(minutes=60)})
        for ev in history["events"]:
            payload = {**ev["payload"], "synthetic": True, "occurred_at": at(ev["days_ago"]).date().isoformat()}
            c.execute(text("SELECT app.append_audit(:t, :a, NULL, :conv, NULL, CAST(:p AS jsonb))"),
                      {"t": ev["type"], "a": ev["actor"], "conv": ev.get("conversation"), "p": json.dumps(payload, ensure_ascii=False)})
    engine.dispose()
    return {"usage": len(history["usage"]), "events": len(history["events"]), "transcripts": len(history["transcripts"])}
