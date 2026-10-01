"""Relevance gate and answer excerpt for knowledge answers (ported to the static demo).

Retrieval (hybrid in Postgres, MiniSearch in the demo) finds candidates; this module decides,
the same way in both engines, whether the knowledge base actually covers the question and
which passage answers it:

- coverage: the IDF-weighted share of the question's content terms present in a chunk, IDF
  computed over the chunks in scope. Terms the corpus has never seen weigh the most, so "qual
  a previsão do tempo amanhã?" finds no chunk that covers it and nothing is cited.
- excerpt: at most three sentences (or the matching rows of a table, or list items) of the
  best chunk, ranked by the same weights and kept as Markdown.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from atrium.runtime.nlu import STOPWORDS, WORD, singular, stem
from atrium.text import fold

# Calibrated on shared/eval/retrieval.yaml (in-domain) and shared/eval/out-of-domain.yaml; see
# tests/kb/test_relevance.py. A chunk must cover half of the question's weight, or a fifth when
# every term of the question exists somewhere in the corpus (out-of-domain questions almost
# always carry words the company's documents never use: "futebol", "cenoura", "Austrália").
MIN_COVERAGE = 0.5
MIN_COVERAGE_KNOWN = 0.2
MIN_CITED = 0.3  # a retrieval hit is cited only when it covers this share of the question
MAX_UNITS = 3
MAX_TABLE_ROWS = 6


def tokens(text: str) -> list[str]:
    """Stems of the singular forms: "confidenciais" and "confidencial" meet, as do "avaliações"
    and "avaliação"."""
    return [stem(singular(t)) for t in WORD.findall(fold(text)) if t not in STOPWORDS]


GENERIC = set(tokens("funciona funcionam funcionar empresa aqui quero queria saber sobre gostaria posso pode preciso "
                     "regra regras politica explicar explica entender ajuda ajudar dizer fale falar coisa coisas assunto "
                     "algum alguma existe tenho temos fazer faco vale pena caso duvida informacao informacoes melhor quem "
                     "acontece deve devo num numa agora passa dica dicas recomenda peco pedir solicitar solicito obter "
                     "conseguir consigo"))
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9\"“*(])")
LIST_ITEM = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+")


@dataclass(frozen=True)
class Chunk:
    id: str
    kb: str
    document: str
    section: str
    content: str
    source: str = ""


def query_terms(query: str) -> list[str]:
    out: list[str] = []
    for t in tokens(query):
        if t not in GENERIC and t not in out:
            out.append(t)
    return out


class Lexicon:
    """Document frequencies of the chunks in scope (the agent's knowledge bases). ``vocabulary``
    is every term of the company corpus, to tell "rare here" from "never written anywhere"."""

    def __init__(self, chunks: list[Chunk], vocabulary: set[str] | frozenset[str] = frozenset()) -> None:
        self.chunks = chunks
        self.terms = [set(tokens(f"{c.document} {c.section} {c.content}")) for c in chunks]
        self.heads = [set(tokens(f"{c.document} {c.section}")) for c in chunks]
        df: dict[str, int] = {}
        for ts in self.terms:
            for t in ts:
                df[t] = df.get(t, 0) + 1
        self.n = len(chunks)
        self.df = df
        self.vocabulary = vocabulary

    def idf(self, term: str) -> float:
        return math.log(1 + (self.n + 1) / (self.df.get(term, 0) + 0.5))

    def best(self, query: str) -> tuple[Chunk | None, float]:
        q = query_terms(query)
        total = sum(self.idf(t) for t in q)
        if not total or not self.chunks:
            return None, 0.0

        def rank(i: int) -> tuple:
            cov = sum(self.idf(t) for t in q if t in self.terms[i]) / total
            head = sum(self.idf(t) for t in q if t in self.heads[i]) / total
            return (round(cov, 6), round(head, 6), -len(self.chunks[i].content), self.chunks[i].id)

        i = max(range(self.n), key=rank)
        return self.chunks[i], round(rank(i)[0], 6)

    def answer(self, query: str) -> tuple[Chunk | None, float]:
        """The chunk that answers the question, or None when the knowledge base does not cover it."""
        chunk, cov = self.best(query)
        known = all(t in self.vocabulary or t in self.df for t in query_terms(query))
        if chunk is None or cov < MIN_COVERAGE and not (known and cov >= MIN_COVERAGE_KNOWN):
            return None, cov
        return chunk, cov

    def coverage_of(self, query: str, chunk_id: str) -> float:
        """How much of the question a retrieval hit covers (0 when the hit is not in scope)."""
        q = query_terms(query)
        total = sum(self.idf(t) for t in q)
        i = next((k for k, c in enumerate(self.chunks) if c.id == chunk_id), None)
        return sum(self.idf(t) for t in q if t in self.terms[i]) / total if total and i is not None else 0.0


def _units(content: str) -> list[tuple[str, str]]:
    """(kind, text) in document order: sentence | item | table."""
    out: list[tuple[str, str]] = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if lines and all(ln.lstrip().startswith("|") for ln in lines):
            out.append(("table", "\n".join(lines)))
        elif lines and all(LIST_ITEM.match(ln) for ln in lines):
            out += [("item", LIST_ITEM.sub("", ln).strip()) for ln in lines]
        else:
            out += [("sentence", s.strip()) for s in SENTENCE_END.split(" ".join(ln.strip() for ln in lines)) if s.strip()]
    return out


def excerpt(content: str, query: str, lex: Lexicon) -> str:
    """The useful part of a chunk for this question, as Markdown (never the raw chunk)."""
    q = query_terms(query)

    def weight(text: str) -> float:
        ts = set(tokens(text))
        return sum(lex.idf(t) for t in q if t in ts)

    units = _units(content)
    if not units:
        return ""
    scored = [(weight(text), i) for i, (_kind, text) in enumerate(units)]
    tables = [(s, i) for s, i in scored if units[i][0] == "table"]
    prose = [(s, i) for s, i in scored if units[i][0] != "table"]
    best_prose = max((s for s, _ in prose), default=0.0)
    if tables:
        top_table = max(tables, key=lambda x: (x[0], -x[1]))
        if top_table[0] > 0 and top_table[0] >= best_prose:
            return _table_excerpt(units[top_table[1]][1], q)
    chosen = sorted(sorted(prose, key=lambda x: (-x[0], x[1]))[:MAX_UNITS], key=lambda x: x[1]) if best_prose > 0 else prose[:2]
    lines: list[str] = []
    for _s, i in chosen:
        kind, text = units[i]
        if kind == "item":
            lines.append(f"- {text}")
        elif lines and not lines[-1].startswith("- "):
            lines[-1] += " " + text
        else:
            lines.append(text)
    return "\n".join(lines)


def _table_excerpt(table: str, q: list[str]) -> str:
    rows = table.split("\n")
    header, body = rows[:2], [r for r in rows[2:] if r.strip()]
    hits = [r for r in body if any(t in set(tokens(r)) for t in q)]
    keep = (hits or body)[:MAX_TABLE_ROWS]
    return "\n".join([*header, *keep])
