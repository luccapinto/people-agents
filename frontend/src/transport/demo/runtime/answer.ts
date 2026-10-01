/** Relevance gate and answer excerpt for knowledge answers (`atrium.kb.answer`).
 *
 *  Retrieval (hybrid in Postgres, MiniSearch in the demo) finds candidates; this module decides,
 *  the same way in both engines, whether the knowledge base actually covers the question and
 *  which passage answers it:
 *
 *  - coverage: the IDF-weighted share of the question's content terms present in a chunk, IDF
 *    computed over the chunks in scope. Terms the corpus has never seen weigh the most, so "qual
 *    a previsão do tempo amanhã?" finds no chunk that covers it and nothing is cited.
 *  - excerpt: at most three sentences (or the matching rows of a table, or list items) of the
 *    best chunk, ranked by the same weights and kept as Markdown. */
import { pyRound } from '../core/money';
import { fold } from '../core/text';
import { STOPWORDS, singular, stem, words } from './nlu';

// Calibrated on shared/eval/retrieval.yaml (in-domain) and shared/eval/out-of-domain.yaml; see
// tests/kb/test_relevance.py. A chunk must cover half of the question's weight, or a fifth when
// every term of the question exists somewhere in the corpus (out-of-domain questions almost
// always carry words the company's documents never use: "futebol", "cenoura", "Austrália").
export const MIN_COVERAGE = 0.5;
export const MIN_COVERAGE_KNOWN = 0.2;
export const MIN_CITED = 0.3; // a retrieval hit is cited only when it covers this share of the question
const MAX_UNITS = 3;
const MAX_TABLE_ROWS = 6;

/** Stems of the singular forms: "confidenciais" and "confidencial" meet, as do "avaliações"
 *  and "avaliação". */
export function tokens(text: string): string[] {
  return words(fold(text))
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => stem(singular(t)));
}

const GENERIC = new Set(
  tokens(
    'funciona funcionam funcionar empresa aqui quero queria saber sobre gostaria posso pode preciso ' +
      'regra regras politica explicar explica entender ajuda ajudar dizer fale falar coisa coisas assunto ' +
      'algum alguma existe tenho temos fazer faco vale pena caso duvida informacao informacoes melhor quem ' +
      'acontece deve devo num numa agora passa dica dicas recomenda peco pedir solicitar solicito obter ' +
      'conseguir consigo',
  ),
);
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9"“*(])/;
const LIST_ITEM = /^\s*(?:[-*]|\d+[.)])\s+/;

export interface Chunk {
  id: string;
  kb: string;
  document: string;
  section: string;
  content: string;
  source: string;
}

export function queryTerms(query: string): string[] {
  const out: string[] = [];
  for (const t of tokens(query)) {
    if (!GENERIC.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Document frequencies of the chunks in scope (the agent's knowledge bases). `vocabulary`
 *  is every term of the company corpus, to tell "rare here" from "never written anywhere". */
export class Lexicon {
  private readonly terms: Set<string>[];
  private readonly heads: Set<string>[];
  private readonly df = new Map<string, number>();
  private readonly n: number;

  constructor(
    readonly chunks: Chunk[],
    private readonly vocabulary: Set<string> = new Set(),
  ) {
    this.terms = chunks.map((c) => new Set(tokens(`${c.document} ${c.section} ${c.content}`)));
    this.heads = chunks.map((c) => new Set(tokens(`${c.document} ${c.section}`)));
    for (const ts of this.terms) {
      for (const t of ts) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.n = chunks.length;
  }

  idf(term: string): number {
    return Math.log(1 + (this.n + 1) / ((this.df.get(term) ?? 0) + 0.5));
  }

  best(query: string): [Chunk | null, number] {
    const q = queryTerms(query);
    let total = 0;
    for (const t of q) total += this.idf(t);
    if (!total || !this.chunks.length) return [null, 0];
    const rank = (i: number): [number, number, number, string] => {
      let cov = 0;
      let head = 0;
      for (const t of q) {
        if (this.terms[i].has(t)) cov += this.idf(t);
        if (this.heads[i].has(t)) head += this.idf(t);
      }
      return [pyRound(cov / total, 6), pyRound(head / total, 6), -this.chunks[i].content.length, this.chunks[i].id];
    };
    let bestIndex = 0;
    let bestRank = rank(0);
    for (let i = 1; i < this.n; i += 1) {
      const r = rank(i);
      const better =
        r[0] > bestRank[0] ||
        (r[0] === bestRank[0] &&
          (r[1] > bestRank[1] ||
            (r[1] === bestRank[1] && (r[2] > bestRank[2] || (r[2] === bestRank[2] && r[3] > bestRank[3])))));
      if (better) {
        bestIndex = i;
        bestRank = r;
      }
    }
    return [this.chunks[bestIndex], pyRound(bestRank[0], 6)];
  }

  /** The chunk that answers the question, or null when the knowledge base does not cover it. */
  answer(query: string): [Chunk | null, number] {
    const [chunk, cov] = this.best(query);
    const known = queryTerms(query).every((t) => this.vocabulary.has(t) || this.df.has(t));
    if (chunk === null || (cov < MIN_COVERAGE && !(known && cov >= MIN_COVERAGE_KNOWN))) return [null, cov];
    return [chunk, cov];
  }

  /** How much of the question a retrieval hit covers (0 when the hit is not in scope). */
  coverageOf(query: string, chunkId: string): number {
    const q = queryTerms(query);
    let total = 0;
    for (const t of q) total += this.idf(t);
    const i = this.chunks.findIndex((c) => c.id === chunkId);
    if (!total || i < 0) return 0;
    let cov = 0;
    for (const t of q) if (this.terms[i].has(t)) cov += this.idf(t);
    return cov / total;
  }
}

type Unit = ['table' | 'item' | 'sentence', string];

/** (kind, text) in document order: sentence | item | table. */
function units(content: string): Unit[] {
  const out: Unit[] = [];
  for (const block of content.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((ln) => ln.trim());
    if (lines.length && lines.every((ln) => ln.trimStart().startsWith('|'))) {
      out.push(['table', lines.join('\n')]);
    } else if (lines.length && lines.every((ln) => LIST_ITEM.test(ln))) {
      for (const ln of lines) out.push(['item', ln.replace(LIST_ITEM, '').trim()]);
    } else {
      const joined = lines.map((ln) => ln.trim()).join(' ');
      for (const s of joined.split(new RegExp(SENTENCE_END.source, 'g'))) {
        if (s.trim()) out.push(['sentence', s.trim()]);
      }
    }
  }
  return out;
}

/** Rows that mention the question, or the first rows when the question names a column
 *  ("quais são os prefixos?" asks for the whole "Prefixo" column). */
function tableExcerpt(table: string, q: string[]): string {
  const rows = table.split('\n');
  const header = rows.slice(0, 2);
  const body = rows.slice(2).filter((r) => r.trim());
  const columns = new Set(tokens(rows[0]));
  if (q.some((t) => columns.has(t))) return [...header, ...body.slice(0, MAX_TABLE_ROWS)].join('\n');
  const hits = body.filter((r) => {
    const ts = new Set(tokens(r));
    return q.some((t) => ts.has(t));
  });
  const keep = (hits.length ? hits : body).slice(0, MAX_TABLE_ROWS);
  return [...header, ...keep].join('\n');
}

/** The useful part of a chunk for this question, as Markdown (never the raw chunk). */
export function excerpt(content: string, query: string, lex: Lexicon): string {
  const q = queryTerms(query);
  const weight = (text: string): number => {
    const ts = new Set(tokens(text));
    let s = 0;
    for (const t of q) if (ts.has(t)) s += lex.idf(t);
    return s;
  };
  const list = units(content);
  if (!list.length) return '';
  const scored = list.map((u, i) => [weight(u[1]), i] as [number, number]);
  const tables = scored.filter(([, i]) => list[i][0] === 'table');
  const prose = scored.filter(([, i]) => list[i][0] !== 'table');
  const bestProse = prose.length ? Math.max(...prose.map(([s]) => s)) : 0;
  if (tables.length) {
    let top = tables[0];
    for (const t of tables.slice(1)) if (t[0] > top[0] || (t[0] === top[0] && -t[1] > -top[1])) top = t;
    if (top[0] > 0 && top[0] >= bestProse) return tableExcerpt(list[top[1]][1], q);
  }
  const chosen =
    bestProse > 0
      ? [...prose]
          .sort((a, b) => b[0] - a[0] || a[1] - b[1])
          .slice(0, MAX_UNITS)
          .sort((a, b) => a[1] - b[1])
      : prose.slice(0, 2);
  const lines: string[] = [];
  for (const [, i] of chosen) {
    const [kind, text] = list[i];
    if (kind === 'item') lines.push(`- ${text}`);
    else if (lines.length && !lines[lines.length - 1].startsWith('- ')) lines[lines.length - 1] += ` ${text}`;
    else lines.push(text);
  }
  return lines.join('\n');
}
