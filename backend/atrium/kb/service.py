"""Knowledge ingestion and hybrid retrieval (pgvector + Postgres full-text, fused with RRF).

The full-text side ORs the query's lexemes (Portuguese stemming) and ranks with
``ts_rank_cd``, so long natural-language questions still match; the vector side brings
paraphrases. Reciprocal rank fusion (k = 60) merges both lists.

Retrieval runs inside the caller's RLS scope: ``app.kb_visible`` decides which knowledge
bases exist for the identity, and the agent's own knowledge list narrows it further.
Documents flagged with suspected prompt injection are quarantined (not retrievable)
until a curator reviews them.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import Connection, text

from atrium.authz.identity import IdentityContext
from atrium.config import REPO_ROOT
from atrium.db.engine import Database
from atrium.guardrails.injection import detect_injection
from atrium.kb.answer import Chunk, Lexicon, tokens
from atrium.kb.chunking import chunk_markdown, snippet
from atrium.kb.embeddings import Embedder

RRF_K = 60
CANDIDATES = 20
MIN_VECTOR_SIMILARITY = 0.30


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    kb_id: str
    document: str
    section: str
    content: str
    score: float
    source: str

    @property
    def snippet(self) -> str:
        return snippet(self.content)

    def for_model(self) -> dict:
        return {"id": self.chunk_id, "documento": self.document, "secao": self.section, "trecho": self.content[:900]}


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def ingest(conn: Connection, embedder: Embedder, kb_id: str, title: str, source: str, mime: str, markdown: str,
           uploaded_by: str | None = None) -> dict:
    chunks = chunk_markdown(markdown, fallback_title=title)
    flags = sorted({s for c in chunks for s in detect_injection(c.content).signals})
    doc_title = chunks[0].title if chunks else title
    digest = hashlib.sha256(markdown.encode()).hexdigest()
    conn.execute(text("DELETE FROM app.kb_documents WHERE kb_id = :k AND source = :s"), {"k": kb_id, "s": source})
    doc_id = conn.execute(text(
        """INSERT INTO app.kb_documents (kb_id, title, source, mime, sha256, flags, uploaded_by)
           VALUES (:k, :t, :s, :m, :h, CAST(:f AS jsonb), :u) RETURNING id"""),
        {"k": kb_id, "t": doc_title, "s": source, "m": mime, "h": digest,
         "f": json.dumps(["injection_suspected", *flags] if flags else []), "u": uploaded_by}).scalar_one()
    vectors = embedder.embed([f"{c.title}. {c.heading}. {c.content}" for c in chunks]) if chunks else []
    if chunks:
        conn.execute(text(
            """INSERT INTO app.kb_chunks (document_id, kb_id, ordinal, heading, content, embedding)
               VALUES (:d, :k, :o, :h, :c, CAST(:e AS vector))"""),
            [{"d": doc_id, "k": kb_id, "o": c.ordinal, "h": c.heading, "c": c.content, "e": _vec(v)} for c, v in zip(chunks, vectors, strict=True)])
    return {"document_id": str(doc_id), "title": doc_title, "chunks": len(chunks), "quarantined": bool(flags), "signals": flags}


@lru_cache(maxsize=1)
def corpus_vocabulary() -> frozenset[str]:
    """Every term of the company's knowledge corpus (shared/generated/kb-chunks.json, the same
    file the demo indexes), for the relevance gate's "never written anywhere" test."""
    data = json.loads((REPO_ROOT / "shared/generated/kb-chunks.json").read_text())
    return frozenset(t for c in data["chunks"] for t in tokens(f"{c['document']} {c['section']} {c['content']}"))



class KnowledgeService:
    def __init__(self, db: Database, embedder: Embedder) -> None:
        self.db = db
        self.embedder = embedder

    def search(self, identity: IdentityContext, query: str, kb_ids: list[str], limit: int = 4) -> list[Hit]:
        if not kb_ids or not query.strip():
            return []
        qvec = _vec(self.embedder.embed([query])[0])
        with self.db.scoped(identity.employee_id) as c:
            rows = c.execute(text(
                """WITH eligible AS (
                       SELECT ch.id, ch.kb_id, ch.heading, ch.content, ch.embedding, ch.tsv, ch.ordinal, d.title, d.source
                       FROM app.kb_chunks ch JOIN app.kb_documents d ON d.id = ch.document_id
                       WHERE ch.kb_id = ANY(:kbs) AND NOT (d.flags ? 'injection_suspected' AND NOT d.flags ? 'curator_approved')
                   ),
                   vec AS (
                       SELECT id, 1 - (embedding <=> CAST(:q AS vector)) AS sim,
                              row_number() OVER (ORDER BY embedding <=> CAST(:q AS vector), source, ordinal) AS r
                       FROM eligible ORDER BY embedding <=> CAST(:q AS vector), source, ordinal LIMIT :n
                   ),
                   fts AS (
                       SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, query) DESC, source, ordinal) AS r
                       FROM eligible, (SELECT to_tsquery('portuguese', coalesce(nullif(array_to_string(
                               tsvector_to_array(to_tsvector('portuguese', :text)), ' | '), ''), 'zzzznomatch')) AS q) qq,
                            LATERAL (SELECT qq.q AS query) l
                       WHERE tsv @@ query ORDER BY ts_rank_cd(tsv, query) DESC, source, ordinal LIMIT :n
                   ),
                   fused AS (
                       SELECT coalesce(v.id, f.id) AS id,
                              coalesce(1.0 / (:k + v.r), 0) + coalesce(1.0 / (:k + f.r), 0) AS score,
                              v.sim, f.r AS fts_rank
                       FROM vec v FULL OUTER JOIN fts f ON v.id = f.id
                   )
                   SELECT e.id, e.kb_id, e.heading, e.content, e.title, e.source, fu.score, fu.sim, fu.fts_rank
                   FROM fused fu JOIN eligible e ON e.id = fu.id
                   WHERE fu.fts_rank IS NOT NULL OR fu.sim >= :minsim
                   -- Ties are broken by document and position, never by the random chunk id, so the
                   -- same corpus always gives the same answer (and the same goldens).
                   ORDER BY fu.score DESC, e.source, e.ordinal LIMIT :limit"""),
                {"kbs": kb_ids, "q": qvec, "text": query, "n": CANDIDATES, "k": RRF_K, "minsim": MIN_VECTOR_SIMILARITY,
                 "limit": limit}).all()
        return [Hit(str(r.id), r.kb_id, r.title, r.heading, r.content, float(r.score), r.source) for r in rows]

    def lexicon(self, identity: IdentityContext, kb_ids: list[str]) -> Lexicon:
        """The chunks in scope (visible to the identity, not quarantined) for the relevance gate."""
        with self.db.scoped(identity.employee_id) as c:
            rows = c.execute(text(
                """SELECT ch.id, ch.kb_id, ch.heading, ch.content, d.title, d.source
                   FROM app.kb_chunks ch JOIN app.kb_documents d ON d.id = ch.document_id
                   WHERE ch.kb_id = ANY(:kbs) AND NOT (d.flags ? 'injection_suspected' AND NOT d.flags ? 'curator_approved')
                   ORDER BY d.source, ch.ordinal"""), {"kbs": kb_ids}).all()
        return Lexicon([Chunk(str(r.id), r.kb_id, r.title, r.heading, r.content, r.source) for r in rows], corpus_vocabulary())
