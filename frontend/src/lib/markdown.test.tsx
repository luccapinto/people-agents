import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, plainText } from './markdown';

describe('Markdown', () => {
  it('never injects HTML from the model output', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror="alert(1)"> e <script>alert(2)</script>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('renders bold, italic and inline code as elements', () => {
    const { container } = render(<Markdown text="**Saldo** de _12 dias_ no `vacation_balance`" />);
    expect(container.querySelector('strong')?.textContent).toBe('Saldo');
    expect(container.querySelector('em')?.textContent).toBe('12 dias');
    expect(container.querySelector('code')?.textContent).toBe('vacation_balance');
  });

  it('renders bullet and numbered lists', () => {
    const { container } = render(
      <Markdown text={'Opções:\n\n- Primeira\n- Segunda\n\n1. Passo um\n2. Passo dois'} />,
    );
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(screen.getByText('Primeira')).toBeInTheDocument();
  });

  it('keeps single line breaks inside a paragraph', () => {
    const { container } = render(<Markdown text={'Primeira linha\nSegunda linha'} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('preserves Portuguese accents verbatim', () => {
    const { container } = render(<Markdown text="Férias, 13º salário e opção de inclusão" />);
    expect(container.textContent).toBe('Férias, 13º salário e opção de inclusão');
  });

  it('renders a pipe table as a table, not as a flattened line', () => {
    const { container } = render(
      <Markdown text={'Segundo a política:\n\n| Item | Regra |\n|---|---|\n| Dias-âncora | terça e quinta |\n| Auxílio | **R$ 150,00** |'} />,
    );
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody strong')?.textContent).toBe('R$ 150,00');
    expect(container.textContent).not.toContain('---');
  });

  it('leaves a lone pipe line without a rule as text', () => {
    const { container } = render(<Markdown text={'| não é tabela |'} />);
    expect(container.querySelector('table')).toBeNull();
  });

  it('strips inline markers for plain-text labels such as citation headings', () => {
    expect(plainText('Quando o PGBL **não** compensa')).toBe('Quando o PGBL não compensa');
    expect(plainText('Posso fazer join dentro de um modelo `stg_`?')).toBe(
      'Posso fazer join dentro de um modelo stg_?',
    );
    expect(plainText('Perguntas frequentes › Qual a diferença?')).toBe('Perguntas frequentes › Qual a diferença?');
  });
});
