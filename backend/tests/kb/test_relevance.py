"""Knowledge answers: cite the right document, or cite nothing (shared/eval/*.yaml)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.kb.answer import Chunk, Lexicon, excerpt
from atrium.kb.service import Hit
from atrium.runtime.agents import agent_catalog
from atrium.runtime.tool import ToolContext
from atrium.tools.common import knowledge_answer

pytestmark = pytest.mark.db

IN_DOMAIN = yaml.safe_load((REPO_ROOT / "shared/eval/retrieval.yaml").read_text())["queries"]
OUT_OF_DOMAIN = yaml.safe_load((REPO_ROOT / "shared/eval/out-of-domain.yaml").read_text())["questions"]
KB_SETS = sorted({tuple(a["knowledge"]) for a in agent_catalog()["agents"]})
WHO = {"lideranca": "gestora", "people-analytics": "hrbp"}
# retrieval.yaml names one document per question (for hit@3). Where another document answers it
# just as well, or where the corpus does not cover the question at all, the honest outcome is
# recorded here with the reason, instead of being bent into the retrieval set.
ALSO = {"Como faço uma denúncia anônima?": "codigo-de-conduta.md",  # its section "Como relatar violações"
        "Qual o limite da diária de hotel?": "viagens-corporativas.md"}  # states "R$ 650,00 por diária" too
MAY_REFUSE = {"O que acontece na avaliação do período de experiência?"}  # no document covers probation reviews


def _ctx(services, identity, persona: str) -> ToolContext:
    return ToolContext(identity=identity(persona), services=services, agent_id="test")


def test_in_domain_questions_are_answered_from_the_expected_document(services, identity):
    wrong = []
    for item in IN_DOMAIN:
        persona = next((WHO[k] for k in item["kb"] if k in WHO), "colaborador")
        answer, citations, _ = knowledge_answer(_ctx(services, identity, persona), item["q"], item["kb"])
        if answer is None and item["q"] in MAY_REFUSE:
            continue
        if answer is None or not citations[0].source.endswith((item["doc"], ALSO.get(item["q"], item["doc"]))):
            wrong.append((item["q"], citations[0].source if citations else None))
    assert not wrong, wrong


@pytest.mark.parametrize("item", OUT_OF_DOMAIN, ids=[q["q"][:50] for q in OUT_OF_DOMAIN])
def test_out_of_domain_questions_cite_nothing_in_any_knowledge_base(services, identity, item):
    for kbs in KB_SETS:
        persona = next((WHO[k] for k in kbs if k in WHO), "colaborador")
        answer, citations, _ = knowledge_answer(_ctx(services, identity, persona), item["q"], list(kbs))
        assert answer is None and not citations, (kbs, [c.source for c in citations])


TABLE = ("Convenções de nomes:\n\n| Prefixo | Camada | Propósito |\n|---|---|---|\n"
         "| `stg_` | staging | uma fonte, um modelo: renomeia e limpa |\n"
         "| `int_` | intermediária | lógica reutilizável |\n| `fct_` | ouro | fatos |\n")
LIMITS = ("Limites:\n\n| Categoria | Limite | Unidade |\n|---|---|---|\n| Alimentação em viagem | R$ 180,00 | por dia |\n"
          "| Transporte por aplicativo | R$ 150,00 | por corrida |\n| Hospedagem | R$ 650,00 | por diária |\n")


def test_table_excerpt_keeps_the_column_the_question_asks_for_and_filters_otherwise():
    lex = Lexicon([Chunk("c1", "kb", "Padrões", "Nomes", TABLE), Chunk("c2", "kb", "Reembolso", "Limites", LIMITS)])
    whole = excerpt(TABLE, "Quais são os prefixos de modelos no dbt?", lex)
    assert all(p in whole for p in ("stg_", "int_", "fct_"))
    one = excerpt(TABLE, "O que é lógica reutilizável?", lex)
    assert "int_" in one and "stg_" not in one and "fct_" not in one
    # "limite" names a column, but "alimentação em viagem" names a row: the row wins.
    meal = excerpt(LIMITS, "Qual o limite de alimentação em viagem?", lex)
    assert "180,00" in meal and "150,00" not in meal and "650,00" not in meal


class _TiedRetrieval:
    """Retrieval that ranks two chunks equally, the one first in document order covering only the
    question's common words (fastembed and full-text ranks swapped gave exactly this RRF tie)."""

    def __init__(self) -> None:
        days = Chunk("days", "ferias", "Política de Férias", "Quantos dias eu tenho",
                     "| Faltas injustificadas | Dias de férias |\n|---|---|\n| Até 5 | 30 dias corridos |")
        sell = Chunk("sell", "ferias", "Política de Férias", "Perguntas frequentes › Posso vender 15 dias de férias?",
                     "Não. O abono é limitado a 1/3 do período de direito (CLT, art. 143). Quem tem 30 dias pode vender no máximo 10.")
        other = [Chunk(f"o{i}", "corporativo", doc, doc, body) for i, (doc, body) in enumerate([
            ("Reembolsos", "Táxi até R$ 150,00 por corrida."), ("Benefícios", "O plano de saúde cobre dependentes."),
            ("Ponto", "Banco de horas compensado em seis meses."), ("Carreira", "Treinamentos obrigatórios anuais.")])]
        self.chunks = [days, sell, *other]

    def lexicon(self, _identity, _kb_ids) -> Lexicon:
        return Lexicon(self.chunks)

    def search(self, _identity, _query, _kb_ids, limit: int = 4) -> list[Hit]:
        return [Hit(c.id, c.kb, c.document, c.section, c.content, 0.0315 if c.id in ("days", "sell") else 0.02, c.source)
                for c in self.chunks][:limit]


def test_a_retrieval_tie_goes_to_the_hit_that_covers_more_of_the_question():
    ctx = ToolContext(identity=None, services=SimpleNamespace(kb=_TiedRetrieval()), agent_id="test")
    answer, citations, _ = knowledge_answer(ctx, "Posso vender 10 dias de férias?", ["ferias", "corporativo"])
    assert citations[0].section.endswith("Posso vender 15 dias de férias?")
    assert "no máximo 10" in answer and "30 dias corridos" not in answer


def test_a_legal_citation_does_not_end_a_sentence():
    faq = "Não. O abono é limitado a 1/3 do período de direito (CLT, art. 143). Quem tem 30 dias pode vender no máximo 10."
    lex = Lexicon([Chunk("f", "ferias", "Política de Férias", "Posso vender 15 dias de férias?", faq)])
    assert "(CLT, art. 143)." in excerpt(faq, "Posso vender 10 dias de férias?", lex)
