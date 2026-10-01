"""Knowledge answers: cite the right document, or cite nothing (shared/eval/*.yaml)."""

from __future__ import annotations

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.kb.answer import Chunk, Lexicon, excerpt
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


TABLE = ("Convenções de nomes:\n\n| Prefixo | Camada | Propósito |\n|---|---|---|\n| `stg_` | staging | uma fonte, um modelo |\n"
         "| `int_` | intermediária | lógica reutilizável |\n| `fct_` | ouro | fatos |\n")


def test_table_excerpt_keeps_the_column_the_question_asks_for_and_filters_otherwise():
    lex = Lexicon([Chunk("c1", "kb", "Padrões", "Nomes", TABLE)])
    whole = excerpt(TABLE, "Quais são os prefixos de modelos no dbt?", lex)
    assert all(p in whole for p in ("stg_", "int_", "fct_"))
    one = excerpt(TABLE, "O que é lógica reutilizável?", lex)
    assert "int_" in one and "stg_" not in one and "fct_" not in one
