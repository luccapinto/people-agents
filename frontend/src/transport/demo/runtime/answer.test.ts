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

describe('excerpt of prose', () => {
  it('does not end a sentence at a legal citation', () => {
    const faq = 'Não. O abono é limitado a 1/3 do período de direito (CLT, art. 143). Quem tem 30 dias pode vender no máximo 10.';
    const lex = new Lexicon([{ id: 'f', kb: 'ferias', document: 'Política de Férias', section: 'Posso vender 15 dias de férias?', content: faq, source: '' }]);
    expect(excerpt(faq, 'Posso vender 10 dias de férias?', lex)).toContain('(CLT, art. 143).');
  });

  // Same assertions as backend/tests/kb/test_relevance.py.
  it('keeps a yes or no only for the question its heading asks', () => {
    const faq = 'Não. O abono é limitado a 1/3 do período de direito. Quem tem 30 dias pode vender no máximo 10.';
    const lex = new Lexicon([
      { id: 'f', kb: 'ferias', document: 'Política de Férias', section: 'Posso vender 15 dias de férias?', content: faq, source: '' },
    ]);
    const heading = 'Perguntas frequentes › Posso vender 15 dias de férias?';
    expect(excerpt(faq, 'Posso vender 15 dias de férias?', lex, heading).startsWith('Não.')).toBe(true);
    expect(excerpt(faq, 'Posso vender 10 dias de férias?', lex, heading).startsWith('O abono')).toBe(true);
    const note = 'Não esqueça: a comunicação do nascimento deve ocorrer em até 2 dias úteis.';
    const noteLex = new Lexicon([{ id: 'n', kb: 'ferias', document: 'Licenças', section: 'Prazos', content: note, source: '' }]);
    expect(excerpt(note, 'Quando comunico o nascimento?', noteLex, 'Prazos')).toEqual(note);
    // A negation is not a yes/no answer: these stay whole even when the heading is not the question.
    for (const first of ['Não automaticamente.', 'Não há perda do direito ao auxílio.']) {
      const text = `${first} O restante segue a política.`;
      const section = 'Perguntas frequentes › Outra pergunta qualquer?';
      const lex2 = new Lexicon([{ id: 'x', kb: 'kb', document: 'Doc', section, content: text, source: '' }]);
      expect(excerpt(text, 'Como peço o auxílio?', lex2, section).startsWith(first)).toBe(true);
    }
  });
});
