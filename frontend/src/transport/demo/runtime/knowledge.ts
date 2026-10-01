/** In-browser knowledge retrieval: MiniSearch over the generated chunks.
 *
 *  Visibility mirrors `app.kb_visible`: governance sees everything, otherwise the base must be
 *  owned by the identity, public, or targeted at a unit on the identity's path / a role it has.
 *  Documents flagged with suspected prompt injection stay quarantined. */
import MiniSearch from 'minisearch';
import { type IdentityContext, isGovernance, rolesOf } from '../authz/identity';
import { fold } from '../core/text';
import type { Audience, KbChunk } from '../data/types';
import { type Chunk, Lexicon, tokens as answerTokens } from './answer';

export interface KbBaseRow {
  id: string;
  name: string;
  description: string;
  audience: Audience;
  owner_id: string | null;
}

export interface KbDocumentRow {
  id: string;
  kb_id: string;
  title: string;
  source: string;
  mime: string;
  flags: string[];
  uploaded_by: string | null;
  created_at: string;
}

export interface Hit {
  chunkId: string;
  kbId: string;
  document: string;
  section: string;
  content: string;
  score: number;
  source: string;
  snippet: string;
}

export function snippetOf(content: string, limit = 300): string {
  const text = content.replace(/[*_`>#|]/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(' ', limit);
  return `${text.slice(0, cut > 0 ? cut : limit)}…`;
}

export class KnowledgeService {
  private vocabulary: Set<string> | null = null;
  readonly bases: KbBaseRow[] = [];
  readonly documents: KbDocumentRow[] = [];
  readonly chunks: (KbChunk & { document_id: string })[] = [];
  private index: MiniSearch<KbChunk & { document_id: string }> | null = null;

  constructor(private readonly corpus: KbChunk[] = []) {}

  rebuild(): void {
    const index = new MiniSearch<KbChunk & { document_id: string }>({
      fields: ['heading', 'content'],
      storeFields: ['kb'],
      idField: 'id',
      processTerm: (term) => {
        const folded = fold(term);
        return folded.length > 1 ? folded : null;
      },
      tokenize: (text) => fold(text).split(/[^a-z0-9]+/).filter(Boolean),
      extractField: (doc, fieldName) =>
        fieldName === 'heading' ? `${doc.document} ${doc.section}` : (doc as unknown as Record<string, string>)[fieldName],
    });
    index.addAll(this.chunks);
    this.index = index;
  }

  addDocument(row: KbDocumentRow, chunks: (KbChunk & { document_id: string })[]): void {
    const removed = this.chunks.filter((c) => c.document_id === row.id);
    for (const c of removed) this.chunks.splice(this.chunks.indexOf(c), 1);
    this.chunks.push(...chunks);
    this.documents.push(row);
    this.rebuild();
  }

  /** `app.kb_visible(kb)` for this identity. */
  visible(identity: IdentityContext, kbId: string): boolean {
    if (isGovernance(identity)) return true;
    const kb = this.bases.find((b) => b.id === kbId);
    if (!kb) return false;
    if (kb.owner_id === identity.employeeId) return true;
    const audience = kb.audience ?? { type: 'all' };
    if (audience.type === 'all') return true;
    if (audience.type === 'units') return (audience.units ?? []).some((u) => identity.unitPath.includes(u));
    if (audience.type === 'roles') {
      const roles = rolesOf(identity);
      return (audience.roles ?? []).some((r) => roles.includes(r));
    }
    return false;
  }

  visibleBases(identity: IdentityContext): KbBaseRow[] {
    return this.bases.filter((b) => this.visible(identity, b.id));
  }

  private quarantined(documentId: string): boolean {
    const doc = this.documents.find((d) => d.id === documentId);
    if (!doc) return false;
    return doc.flags.includes('injection_suspected') && !doc.flags.includes('curator_approved');
  }

  search(identity: IdentityContext, query: string, kbIds: string[], limit = 4): Hit[] {
    if (!kbIds.length || !query.trim()) return [];
    if (!this.index) this.rebuild();
    const allowed = new Set(kbIds.filter((id) => this.visible(identity, id)));
    if (!allowed.size) return [];
    const results = this.index!.search(query, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR',
      filter: (result) => allowed.has(result.kb as string),
    });
    const byId = new Map(this.chunks.map((c) => [c.id, c]));
    const hits: Hit[] = [];
    for (const r of results) {
      const chunk = byId.get(String(r.id));
      if (!chunk || this.quarantined(chunk.document_id)) continue;
      hits.push({
        chunkId: chunk.id,
        kbId: chunk.kb,
        document: chunk.document,
        section: chunk.section,
        content: chunk.content,
        score: r.score,
        source: chunk.source,
        snippet: chunk.snippet || snippetOf(chunk.content),
      });
      if (hits.length === limit) break;
    }
    return hits;
  }

  /** The chunks in scope (visible to the identity, not quarantined) for the relevance gate. */
  lexicon(identity: IdentityContext, kbIds: string[]): Lexicon {
    // Every term of the company's knowledge corpus, for the gate's "never written anywhere" test.
    this.vocabulary ??= new Set(this.corpus.flatMap((c) => answerTokens(`${c.document} ${c.section} ${c.content}`)));
    const allowed = new Set(kbIds.filter((id) => this.visible(identity, id)));
    const rows = this.chunks
      .filter((c) => allowed.has(c.kb) && !this.quarantined(c.document_id))
      .slice()
      .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const chunks: Chunk[] = rows.map((c) => ({
      id: c.id,
      kb: c.kb,
      document: c.document,
      section: c.section,
      content: c.content,
      source: c.source,
    }));
    return new Lexicon(chunks, this.vocabulary);
  }
}

export function hitForModel(h: Hit): Record<string, unknown> {
  return { id: h.chunkId, documento: h.document, secao: h.section, trecho: h.content.slice(0, 900) };
}
