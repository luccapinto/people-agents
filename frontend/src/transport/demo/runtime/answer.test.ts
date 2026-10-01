// @vitest-environment node
/** Same rule as backend/tests/kb/test_relevance.py: both engines cut tables the same way. */
import { describe, expect, it } from 'vitest';
import { excerpt, Lexicon } from './answer';

const TABLE =
  'Convenções de nomes:\n\n| Prefixo | Camada | Propósito |\n|---|---|---|\n' +
  '| `stg_` | staging | uma fonte, um modelo: renomeia e limpa |\n' +
  '| `int_` | intermediária | lógica reutilizável |\n| `fct_` | ouro | fatos |\n';
const LIMITS =
  'Limites:\n\n| Categoria | Limite | Unidade |\n|---|---|---|\n| Alimentação em viagem | R$ 180,00 | por dia |\n' +
  '| Transporte por aplicativo | R$ 150,00 | por corrida |\n| Hospedagem | R$ 650,00 | por diária |\n';

describe('excerpt of a table', () => {
  const lex = new Lexicon([
    { id: 'c1', kb: 'kb', document: 'Padrões', section: 'Nomes', content: TABLE, source: '' },
    { id: 'c2', kb: 'kb', document: 'Reembolso', section: 'Limites', content: LIMITS, source: '' },
  ]);

  it('keeps the column the question asks for and filters rows otherwise', () => {
    const whole = excerpt(TABLE, 'Quais são os prefixos de modelos no dbt?', lex);
    for (const p of ['stg_', 'int_', 'fct_']) expect(whole).toContain(p);
    const one = excerpt(TABLE, 'O que é lógica reutilizável?', lex);
    expect(one).toContain('int_');
    expect(one).not.toContain('stg_');
    expect(one).not.toContain('fct_');
  });

  it('prefers the row a question names over a column it also names', () => {
    const meal = excerpt(LIMITS, 'Qual o limite de alimentação em viagem?', lex);
    expect(meal).toContain('180,00');
    expect(meal).not.toContain('150,00');
    expect(meal).not.toContain('650,00');
  });
});
