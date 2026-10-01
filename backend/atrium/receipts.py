"""Receipt reading: text extraction + deterministic field parser + policy validation.

The receipt is untrusted data. Only parsed fields leave this module; any instruction-like
text is flagged (and audited by the caller) and otherwise ignored.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date

from atrium.guardrails.injection import detect_injection
from atrium.guardrails.pii import CNPJ_RE, valid_cnpj
from atrium.text import fold

AMOUNT_RE = re.compile(r"(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})")
DATE_RE = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
CATEGORY_HINTS = [
    ("hospedagem", ["hotel", "hospedagem", "pousada", "diaria", "diária"]),
    ("transporte por aplicativo", ["taxi", "táxi", "uber", "99", "corrida", "transporte"]),
    ("alimentação em viagem", ["restaurante", "refeicao", "refeição", "almoco", "almoço", "jantar", "lanchonete", "cafe", "café"]),
    ("material de escritório", ["papelaria", "caneta", "caderno", "escritorio", "escritório", "toner"]),
]
NOT_REIMBURSABLE = {"bebidas alcoólicas": ["cerveja", "chopp", "vinho", "caipirinha", "whisky", "drink"],
                    "multas de trânsito": ["multa", "infracao", "infração"]}


def extract_text(data: bytes, mime: str, filename: str) -> str:
    name = filename.lower()
    if mime == "application/pdf" or name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if mime.startswith("text/") or name.endswith((".txt", ".md")):
        return data.decode("utf-8", errors="replace")
    return ""  # images: no OCR in the reference build (see docs/connectors.md for adding one)


def _amount(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


@dataclass
class ReceiptFields:
    amount: float | None
    date: date | None
    cnpj: str | None
    merchant: str | None
    category: str | None
    items_flagged: list[str] = field(default_factory=list)
    injection_signals: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"amount": self.amount, "date": self.date.isoformat() if self.date else None, "cnpj": self.cnpj,
                "merchant": self.merchant, "category": self.category, "items_flagged": self.items_flagged,
                "injection_signals": self.injection_signals}


def parse_receipt(text: str) -> ReceiptFields:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    folded = fold(text)
    amount = None
    # Prefer lines that *start* with "total"/"valor total" (receipt layout); free text elsewhere
    # mentioning a total (including injected instructions) does not override them.
    anchored = [ln for ln in lines if re.match(r"^(valor\s+)?total\b", fold(ln))]
    loose = [ln for ln in lines if "total" in fold(ln)]
    for ln in anchored or loose:
        found = AMOUNT_RE.findall(ln)
        if found:
            amount = _amount(found[-1])
            break
    if amount is None:
        values = [_amount(v) for v in AMOUNT_RE.findall(text)]
        amount = max(values) if values else None
    day = None
    for m in DATE_RE.finditer(text):
        try:
            day = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            break
        except ValueError:
            continue
    cnpj = next((m.group(0) for m in CNPJ_RE.finditer(text) if valid_cnpj(m.group(0))), None)
    merchant = None
    for ln in lines:
        f = fold(ln)
        if f.startswith(("razao social", "estabelecimento", "emitente")):
            merchant = ln.split(":", 1)[-1].strip() or None
            break
    if merchant is None and lines:
        merchant = lines[0][:80]
    category = None
    for cat, words in CATEGORY_HINTS:
        if any(fold(w) in folded for w in words):
            category = cat
            break
    flagged = [label for label, words in NOT_REIMBURSABLE.items() if any(w in folded for w in words)]
    verdict = detect_injection(text)
    return ReceiptFields(amount, day, cnpj, merchant, category, flagged, list(verdict.signals))


def validate(fields: ReceiptFields, category: str | None, today: date, policy: dict) -> list[dict]:
    issues = []
    cat = category or fields.category
    rules = policy["categories"]
    if cat not in rules:
        issues.append({"code": "category", "severity": "error", "message": "Categoria não reconhecida; escolha uma categoria da política."})
    elif fields.amount is not None and fields.amount > rules[cat]["limit"] and rules[cat]["per"] != "km":
        issues.append({"code": "limit", "severity": "error",
                       "message": f"Valor acima do limite da política para {cat} (R$ {rules[cat]['limit']:.2f} por {rules[cat]['per']})".replace(".", ",")})
    if fields.amount is None:
        issues.append({"code": "amount", "severity": "error", "message": "Não encontrei o valor total no comprovante."})
    if fields.date is None:
        issues.append({"code": "date", "severity": "error", "message": "Não encontrei a data no comprovante."})
    elif (today - fields.date).days > policy["submit_within_days"]:
        issues.append({"code": "deadline", "severity": "error", "message": f"O comprovante tem mais de {policy['submit_within_days']} dias."})
    elif fields.date > today:
        issues.append({"code": "future", "severity": "error", "message": "A data do comprovante está no futuro."})
    if fields.cnpj is None:
        issues.append({"code": "cnpj", "severity": "warning", "message": "CNPJ do estabelecimento não encontrado ou inválido."})
    for item in fields.items_flagged:
        issues.append({"code": "not_reimbursable", "severity": "error", "message": f"Itens não reembolsáveis pela política: {item}."})
    if fields.injection_signals:
        issues.append({"code": "injection", "severity": "warning",
                       "message": "O comprovante contém texto com instruções; ele foi ignorado e registrado na auditoria."})
    return issues
