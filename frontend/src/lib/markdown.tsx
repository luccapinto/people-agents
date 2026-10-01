import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, allocation-free-ish Markdown subset renderer: paragraphs, unordered and ordered
 * lists, pipe tables, `**bold**`, `_italic_`, `` `code` `` and hard line breaks. It never parses
 * or injects HTML: every piece of input ends up as a React text node, so markup in the model
 * output (or in a tool result) is shown literally instead of being executed.
 */

type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; value: string };

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', value: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ kind: 'bold', value: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      out.push({ kind: 'code', value: token.slice(1, -1) });
    } else {
      out.push({ kind: 'italic', value: token.slice(1, -1) });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** The text of an inline-Markdown string without its markers, for labels that are not rendered
 *  as Markdown (citation headings, tooltips). */
export function plainText(text: string): string {
  return parseInline(text)
    .map((piece) => piece.value)
    .join('');
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((piece, i) => {
    const key = `${keyPrefix}-${i}`;
    if (piece.kind === 'bold') {
      return (
        <strong key={key} className="font-semibold">
          {piece.value}
        </strong>
      );
    }
    if (piece.kind === 'italic') return <em key={key}>{piece.value}</em>;
    if (piece.kind === 'code') {
      return (
        <code key={key} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.92em]">
          {piece.value}
        </code>
      );
    }
    return <Fragment key={key}>{piece.value}</Fragment>;
  });
}

function withBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyPrefix}-br-${i}`} />);
    out.push(...renderInline(line, `${keyPrefix}-${i}`));
  });
  return out;
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // A header row followed by a |---|---| rule starts a table; rows run until a non-row line.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? '')) {
      flushParagraph();
      flushList();
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[2]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) =>
        block.kind === 'paragraph' ? (
          <p key={i} className="whitespace-pre-wrap text-chat text-text-2">
            {withBreaks(block.text, `p${i}`)}
          </p>
        ) : block.kind === 'table' ? (
          <div key={i} className="scroll-thin overflow-x-auto rounded-card border border-border">
            <table className="w-full border-collapse text-left text-ui text-text-2">
              <thead className="bg-surface text-meta text-text-3">
                <tr>
                  {block.header.map((cell, j) => (
                    <th key={j} scope="col" className="px-3 py-1.5 font-medium">
                      {renderInline(cell, `h${i}-${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-border">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 align-top">
                        {renderInline(cell, `t${i}-${r}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : block.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5 text-chat text-text-2">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 text-chat text-text-2">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
