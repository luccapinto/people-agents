// @vitest-environment node
/** Same rule as backend/tests/kb/test_relevance.py: both engines cut tables the same way. */
import { describe, expect, it } from 'vitest';
import { excerpt, Lexicon } from './answer';

const TABLE =
  'Convenções de nomes:\n\n| Prefixo | Camada | Propósito |\n|---|---|---|\n| `stg_` | staging | uma fonte, um modelo |\n' +
  '| `int_` | intermediária | lógica reutilizável |\n| `fct_` | ouro | fatos |\n';

describe('excerpt of a table', () => {
  it('keeps the column the question asks for and filters rows otherwise', () => {
    const lex = new Lexicon([{ id: 'c1', kb: 'kb', document: 'Padrões', section: 'Nomes', content: TABLE, source: '' }]);
    const whole = excerpt(TABLE, 'Quais são os prefixos de modelos no dbt?', lex);
    for (const p of ['stg_', 'int_', 'fct_']) expect(whole).toContain(p);
    const one = excerpt(TABLE, 'O que é lógica reutilizável?', lex);
    expect(one).toContain('int_');
    expect(one).not.toContain('stg_');
    expect(one).not.toContain('fct_');
  });
});
