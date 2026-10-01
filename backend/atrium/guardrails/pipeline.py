"""Input and output guardrails. Each returns pass | warn | mask | block with a reason; the
outcomes are streamed to the "Por dentro" panel and audited."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from atrium.authz.policy import PolicyStore
from atrium.guardrails.injection import WARN_ONLY, detect_injection
from atrium.guardrails.pii import CPF_RE, mask_pii, valid_cpf
from atrium.runtime.nlu import contains_phrase
from atrium.text import fold

SECRET_PATTERNS = [
    ("api_key", re.compile(r"\b(sk|rk|pk)-[A-Za-z0-9_-]{20,}")),
    ("aws_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("password", re.compile(r"\b(senha|password|pwd|passwd)\s*[:=]\s*\S{4,}", re.IGNORECASE)),
]
SENSITIVE = {
    "assédio": ["assedio", "assediada", "assediado", "assediando", "me humilha", "humilhacao", "abuso", "importunacao", "discriminacao", "racismo"],
    "denúncia": ["denuncia", "denunciar", "fraude", "corrupcao", "propina", "desvio de dinheiro"],
    "saúde mental": ["ansiedade", "depressao", "burnout", "crise de panico", "nao aguento mais", "esgotado", "esgotada",
                     "suicidio", "me matar", "tirar minha vida", "acabar com tudo", "automutilacao"],
}
HIGH_RISK = ["suicidio", "me matar", "tirar minha vida", "acabar com tudo", "automutilacao"]
MONEY_RE = re.compile(r"R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})")


@dataclass
class GuardrailOutcome:
    name: str
    stage: str
    outcome: str
    detail: str

    def as_dict(self) -> dict:
        return {"name": self.name, "stage": self.stage, "outcome": self.outcome, "detail": self.detail}


@dataclass
class InputCheck:
    outcomes: list[GuardrailOutcome]
    stored_text: str
    blocked: bool = False
    message: str = ""
    sensitive: str | None = None
    high_risk: bool = False
    injection: bool = False


@dataclass
class Evidence:
    """What the answer may rely on in this turn."""

    texts: list[str] = field(default_factory=list)
    authorized_people: set[str] = field(default_factory=set)

    def amounts(self) -> set[str]:
        out = set()
        for t in self.texts:
            out.update(MONEY_RE.findall(t))
            for m in re.finditer(r"\b\d+\.\d{1,2}\b", t):  # JSON floats
                v = float(m.group(0))
                out.add(f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
            for m in re.finditer(r"\b\d{2,}\b", t):
                v = float(m.group(0))
                out.add(f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
        return out


@dataclass
class OutputCheck:
    outcomes: list[GuardrailOutcome]
    text: str
    blocked: bool = False


class GuardrailPipeline:
    def __init__(self, store: PolicyStore, directory_names: callable) -> None:
        self.store = store
        self.directory_names = directory_names  # () -> list[str] of employee full names

    # ------------------------------------------------------------------ input
    def check_input(self, text: str) -> InputCheck:
        outcomes: list[GuardrailOutcome] = []
        f = fold(text)
        masked, findings = mask_pii(text)
        outcomes.append(GuardrailOutcome("pii", "input", "mask" if findings else "pass",
                                         ", ".join(f"{x.kind} x{x.count}" for x in findings) or "nenhum dado pessoal detectado"))
        check = InputCheck(outcomes, masked)

        secrets = [name for name, rx in SECRET_PATTERNS if rx.search(text)]
        mode = self.store.value("dlp_secrets_mode", "block")
        if secrets:
            blocked = mode == "block"
            outcomes.append(GuardrailOutcome("dlp_secrets", "input", "block" if blocked else "warn", "detectado: " + ", ".join(secrets)))
            check.stored_text = "[mensagem com credenciais omitida pelo DLP]"
            if blocked:
                check.blocked = True
                check.message = ("Bloqueei esta mensagem porque ela parece conter uma credencial (senha, token ou chave). "
                                 "Nunca cole segredos no chat; se uma credencial vazou, troque-a e avise Segurança da Informação.")
                return check
        else:
            outcomes.append(GuardrailOutcome("dlp_secrets", "input", "pass", "sem credenciais"))

        cpfs = [m.group(0) for m in CPF_RE.finditer(text) if valid_cpf(m.group(0))]
        if len(cpfs) >= 3:
            mode = self.store.value("dlp_customer_data_mode", "warn")
            outcomes.append(GuardrailOutcome("dlp_bulk_personal_data", "input", "block" if mode == "block" else "warn",
                                             f"{len(cpfs)} CPFs na mesma mensagem"))
            if mode == "block":
                check.blocked = True
                check.message = "Esta mensagem tem vários CPFs. Dados pessoais de clientes ou colegas não devem ser colados no chat."
                return check

        topics = [t for t in self.store.value("blocked_topics", []) if contains_phrase(f, t)]
        if topics:
            outcomes.append(GuardrailOutcome("blocked_topics", "input", "block", ", ".join(topics)))
            check.blocked = True
            check.message = (f"Esse assunto ({topics[0]}) está fora do que posso tratar por aqui, conforme a política de uso. "
                             "Posso ajudar com algo do seu trabalho ou dos seus benefícios?")
            return check

        verdict = detect_injection(text)
        check.injection = verdict.suspected
        blocking = [s for s in verdict.signals if s not in WARN_ONLY]
        outcomes.append(GuardrailOutcome("prompt_injection", "input", "block" if blocking else "warn" if verdict.suspected else "pass",
                                         ", ".join(verdict.signals) or "sem sinais"))
        if blocking:
            check.blocked = True
            check.message = ("Não vou fazer isso. Pedidos para ignorar as regras, mudar o meu papel ou mostrar dados de outras "
                             "pessoas são bloqueados pelo sistema antes de chegar a qualquer modelo ou ferramenta, e a tentativa "
                             "fica registrada na auditoria. Posso ajudar com os seus próprios dados ou com as políticas da empresa.")
            return check

        for category, words in SENSITIVE.items():
            if any(contains_phrase(f, w) for w in words):
                check.sensitive = category
                check.high_risk = any(contains_phrase(f, w) for w in HIGH_RISK)
                check.stored_text = f"[conteúdo sensível omitido; categoria: {category}]"
                outcomes.append(GuardrailOutcome("sensitive_topic", "input", "warn",
                                                 f"categoria {category}: encaminhamento ao canal humano, conteúdo não armazenado"))
                break
        return check

    # ------------------------------------------------------------------ output
    def check_output(self, text: str, evidence: Evidence, self_name: str) -> OutputCheck:
        outcomes: list[GuardrailOutcome] = []
        amounts = MONEY_RE.findall(text)
        if amounts:
            leaked = [n for n in self.directory_names() if n != self_name and n not in evidence.authorized_people and n in text]
            if leaked:
                outcomes.append(GuardrailOutcome("third_party_leak", "output", "block",
                                                 f"resposta citava valores junto de {len(leaked)} pessoa(s) não autorizada(s)"))
                return OutputCheck(outcomes, "Não posso compartilhar informações financeiras de outras pessoas. "
                                             "Posso ajudar com os seus próprios dados.", blocked=True)
        outcomes.append(GuardrailOutcome("third_party_leak", "output", "pass", "nenhum dado de terceiro não autorizado"))
        grounded = evidence.amounts()
        ungrounded = sorted({a for a in amounts if a not in grounded})
        if ungrounded:
            outcomes.append(GuardrailOutcome("number_grounding", "output", "warn", "valores sem fonte: " + ", ".join(ungrounded)))
            text += "\n\n_Atenção: alguns valores desta resposta não foram encontrados nas fontes consultadas; confirme no cartão ou no holerite._"
        else:
            outcomes.append(GuardrailOutcome("number_grounding", "output", "pass",
                                             f"{len(amounts)} valor(es) conferido(s) com as fontes" if amounts else "sem valores monetários"))
        return OutputCheck(outcomes, text)
