"""Generate synthetic routing training data with a real model (dev-time only; not used in round 3).

Calls OpenRouter (OPENROUTER_API_KEY in the environment, never printed). The prompts are built only
from the catalog (agent descriptions, tool titles, descriptions and hints, knowledge-base document
titles): the generator never sees an evaluation set. Each intent is an (agent, tool) pair.

    cd backend && uv run python scripts/generate_routing_data.py --out ../shared/training/raw.json --budget 0.05

Every call is appended to the output file with its cost before the next one starts, and the
budget counts what the file already records, so a killed or repeated run can never spend more
than ``--budget`` in total. Reasoning is disabled: with it on, a call cost several times more and
took minutes (round 3 lost a run that way; see docs/decisions/0017-round-2-3-router-and-guardrails.md).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[2]
MODEL = "deepseek/deepseek-v4.1-flash"
URL = "https://openrouter.ai/api/v1/chat/completions"
PER_CALL = 25
CONCURRENCY = 4

SPEAKERS = {
    "leadership": "uma gestora ou um gestor com uma equipe de 8 pessoas, falando do próprio time",
    "people_analytics": "uma HR Business Partner que acompanha indicadores agregados das áreas que atende",
    "governance": "o administrador de governança de IA da empresa, que cuida do assistente, dos agentes e da auditoria",
    "onboarding": "uma pessoa recém-admitida, na primeira ou segunda semana de empresa",
    "data_platform": "uma pessoa do time de Plataforma de Dados (engenharia/análise de dados)",
}
DEFAULT_SPEAKER = "um colaborador ou uma colaboradora qualquer da empresa, falando dos próprios dados e dúvidas"

STYLES = [
    "Estilo A: mensagens curtas e informais de chat, como alguém digita no celular: gírias ('tô', 'pra', 'cê', 'vc', 'blz', 'mano'), "
    "abreviações ('qnd', 'qto', 'pq', 'tb', 'msm'), muitas sem acento, algumas com erro de digitação (letra trocada ou faltando), "
    "algumas sem pontuação, algumas em caixa baixa. Varie o verbo e a construção; não repita o mesmo começo.",
    "Estilo B: mensagens mais longas e naturais: com contexto antes da pergunta ('semana passada eu...', 'tava vendo aqui e...'), "
    "educadas ou diretas, algumas com duas frases, algumas como ordem ('me mostra...', 'preciso de...'), algumas perguntas indiretas, "
    "duas ou três em inglês simples. Use sinônimos e jeitos diferentes de dizer a mesma coisa.",
]

EXTRA_INTENTS = {
    "concierge": {
        "smalltalk": ("Conversa social e meta-perguntas ao assistente", "Cumprimentos, agradecimentos, despedidas, perguntas sobre o que o "
                      "assistente faz, quem ele é, como usar, elogios e reclamações genéricas, sem pedir nada de RH.", []),
        "kb_search": ("Dúvidas gerais sobre a empresa", "Perguntas gerais sobre a empresa que não são de um tema de RH específico: FAQ "
                      "geral (escritórios, horário, ramal, TI, crachá, estacionamento, refeitório), uso responsável de IA no trabalho.",
                      ["FAQ Geral", "Uso Responsável de IA"]),
        "ticket_open": ("Falar com uma pessoa do RH", "A pessoa quer abrir um chamado ou falar com um humano do RH porque o assistente não "
                        "resolveu ou porque prefere atendimento humano.", []),
    },
    "governance": {
        "governance_usage": ("Uso e custo do assistente", "Uso do assistente no mês: interações, custo de IA em dólar, tokens, por agente e "
                             "por área; taxa de resolução sem humano; qual agente é mais usado ou mais caro.", []),
        "governance_guardrails": ("Guardrails e políticas ativas", "Quais guardrails e políticas de governança estão ativos: tópicos "
                                  "bloqueados, DLP de segredos e de dados pessoais, k-anonimato, retenção, limites de uso, e quantas vezes "
                                  "cada guardrail disparou.", []),
        "governance_security_events": ("Eventos de segurança recentes", "Eventos de segurança registrados na auditoria: tentativas de "
                                       "injeção de prompt, acessos negados, respostas bloqueadas, alertas, temas sensíveis.", []),
        "governance_transcript_access": ("Acessos justificados a transcrições", "Quem acessou transcrições de conversas com justificativa, "
                                         "quando, de quem era a conversa e qual o motivo informado.", []),
    },
}


def load_catalog() -> tuple[list[dict], dict, dict[str, list[str]]]:
    agents = yaml.safe_load((ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
    tools = yaml.safe_load((ROOT / "shared/catalog/tools.yaml").read_text())
    chunks = json.loads((ROOT / "shared/generated/kb-chunks.json").read_text())["chunks"]
    docs: dict[str, list[str]] = {}
    for c in chunks:
        docs.setdefault(c["kb"], [])
        if c["document"] not in docs[c["kb"]]:
            docs[c["kb"]].append(c["document"])
    return agents, tools, docs


def intents() -> list[dict]:
    agents, tools, docs = load_catalog()
    out = []
    for a in agents:
        if a["id"] == "concierge":
            continue
        for name in a["tools"]:
            if name == "ticket_open" and a["id"] != "data_platform":
                continue
            if name == "kb_search":
                titles = [t for kb in a["knowledge"] if kb != "corporativo" for t in docs.get(kb, [])]
                if a["id"] == "compliance":
                    titles += [t for t in docs.get("corporativo", []) if t != "FAQ Geral"]
                out.append({"agent": a["id"], "tool": name, "title": f"Dúvidas sobre regras e políticas de {a['name']}",
                            "description": f"Perguntas sobre como as regras funcionam (não sobre os próprios números): {a['description']}",
                            "docs": titles, "hints": []})
                continue
            t = tools[name]
            out.append({"agent": a["id"], "tool": name, "title": t["title"], "description": t["description"],
                        "docs": [], "hints": t.get("hints", [])})
        if a["id"] == "data_platform" and "ticket_open" in a["tools"]:
            out[-1]["description"] = "Abrir chamado para o time de Plataforma de Dados (acesso a dados, incidente, problema em pipeline)."
    for agent, items in EXTRA_INTENTS.items():
        for tool, (title, description, titles) in items.items():
            out.append({"agent": agent, "tool": tool, "title": title, "description": description, "docs": titles, "hints": []})
    return out


def prompt(intent: dict, style: str, agents_by_id: dict) -> str:
    speaker = SPEAKERS.get(intent["agent"], DEFAULT_SPEAKER)
    area = agents_by_id.get(intent["agent"], {}).get("name", intent["agent"])
    lines = [
        "Você ajuda a criar dados de treino para o roteador de um assistente de RH de uma empresa brasileira fictícia (Nimbus).",
        f"Escreva {PER_CALL} mensagens DIFERENTES que {speaker} mandaria no chat interno, todas com a mesma intenção:",
        f"- Área: {area}",
        f"- Intenção: {intent['title']}",
        f"- O que a pessoa quer: {intent['description']}",
    ]
    if intent["docs"]:
        lines.append(f"- Documentos da empresa sobre o tema: {', '.join(intent['docs'])}")
    if intent["hints"]:
        lines.append(f"- Palavras que costumam aparecer (use poucas, prefira sinônimos e outras formas): {', '.join(intent['hints'][:8])}")
    lines += [
        style,
        "Regras: cada mensagem tem só essa intenção; não cite outras áreas; não invente nomes de sistemas; "
        "quando precisar de um nome de colega use primeiros nomes brasileiros comuns; datas e valores realistas.",
        'Responda só com JSON: {"mensagens": ["...", "..."]}',
    ]
    return "\n".join(lines)


async def call(client: httpx.AsyncClient, key: str, text: str, seed: int) -> tuple[list[str], float]:
    body = {"model": MODEL, "messages": [{"role": "user", "content": text}], "max_tokens": 1200, "temperature": 0.9, "seed": seed,
            "response_format": {"type": "json_object"}, "usage": {"include": True}, "reasoning": {"effort": "none"}}
    r = await client.post(URL, json=body, headers={"Authorization": f"Bearer {key}", "X-Title": "Atrium routing data"}, timeout=120)
    r.raise_for_status()
    data = r.json()
    cost = float((data.get("usage") or {}).get("cost") or 0.0)
    content = data["choices"][0]["message"]["content"] or "{}"
    start, end = content.find("{"), content.rfind("}")
    try:
        msgs = json.loads(content[start:end + 1]).get("mensagens", [])
    except json.JSONDecodeError:
        msgs = []
    return [m.strip() for m in msgs if isinstance(m, str) and 3 <= len(m.strip()) <= 400], cost


async def main(out: Path, only: set[str] | None, budget: float) -> None:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key.startswith("sk-or-"):
        raise SystemExit("OPENROUTER_API_KEY is not set")
    agents_by_id = {a["id"]: a for a in load_catalog()[0]}
    todo = [i for i in intents() if not only or i["agent"] in only]
    state = json.loads(out.read_text()) if out.exists() else {"model": MODEL, "cost_usd": 0.0, "calls": 0, "items": []}
    done = {(i["agent"], i["tool"], i["style"]) for i in state["items"]}
    sem = asyncio.Semaphore(CONCURRENCY)
    rng = random.Random(7)
    lock = asyncio.Lock()

    async def one(client, intent, style_index):
        async with sem:
            # Reserve the worst case of one call before sending, so concurrent calls cannot overshoot.
            async with lock:
                if state["cost_usd"] + CONCURRENCY * 0.002 > budget:
                    return
            msgs, cost = await call(client, key, prompt(intent, STYLES[style_index], agents_by_id), rng.randint(1, 10**6))
            async with lock:
                state["cost_usd"] = round(state["cost_usd"] + cost, 6)
                state["calls"] += 1
                state["items"] += [{"agent": intent["agent"], "tool": intent["tool"], "style": "AB"[style_index], "q": m} for m in msgs]
                out.write_text(json.dumps(state, ensure_ascii=False, indent=1))

    pending = [(i, s) for i in todo for s in range(len(STYLES)) if (i["agent"], i["tool"], "AB"[s]) not in done]
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(one(client, i, s) for i, s in pending), return_exceptions=True)
    failures = sum(isinstance(r, Exception) for r in results)
    print(f"pending {len(pending)}, failures {failures}, calls {state['calls']}, messages {len(state['items'])}, cost US$ {state['cost_usd']:.5f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--only", nargs="*", help="agent ids to (re)generate")
    p.add_argument("--budget", type=float, required=True, help="total US$ this output file may ever cost")
    a = p.parse_args()
    asyncio.run(main(a.out, set(a.only) if a.only else None, a.budget))
