"""Heading-aware chunking with overlap, plus text extraction for PDF/DOCX/TXT uploads."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

MAX_CHARS = 1100
OVERLAP_CHARS = 180
HEADING = re.compile(r"^(#{1,4})\s+(.*)$")


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    title: str  # document title (H1)
    heading: str  # "H2 › H3" path inside the document
    content: str


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    pieces, current = [], ""
    for p in paras:
        if current and len(current) + len(p) + 2 > MAX_CHARS:
            pieces.append(current)
            tail = current[-OVERLAP_CHARS:]
            cut = tail.find(" ")
            current = (tail[cut + 1:] if cut >= 0 else tail) + "\n\n" + p
        else:
            current = f"{current}\n\n{p}" if current else p
        while len(current) > MAX_CHARS * 1.5:  # a single huge paragraph
            pieces.append(current[:MAX_CHARS])
            current = current[MAX_CHARS - OVERLAP_CHARS:]
    if current:
        pieces.append(current)
    return pieces


def chunk_markdown(markdown: str, fallback_title: str = "Documento") -> list[Chunk]:
    title = fallback_title
    path: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append((" › ".join(path) or title, [body]))
        buf.clear()

    for line in markdown.splitlines():
        m = HEADING.match(line)
        if m:
            flush()
            level, text = len(m.group(1)), m.group(2).strip()
            if level == 1:
                title, path = text, []
            else:
                depth = level - 2
                path = path[:depth] + [text]
            continue
        buf.append(line)
    flush()
    chunks: list[Chunk] = []
    for heading, (body,) in sections:
        body = re.sub(r"^\*Documento fictício.*\*$", "", body, flags=re.MULTILINE).strip()
        if not body:
            continue
        for piece in _split_long(body):
            chunks.append(Chunk(len(chunks), title, heading, piece.strip()))
    return chunks


def to_markdown(data: bytes, mime: str, filename: str) -> str:
    """Normalize an upload to Markdown-ish text so the same chunker applies."""
    name = filename.lower()
    if name.endswith(".pdf") or mime == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if name.endswith(".docx"):
        import docx

        doc = docx.Document(io.BytesIO(data))
        lines = []
        for p in doc.paragraphs:
            style = (p.style.name or "").lower() if p.style is not None else ""
            if style.startswith("heading") or style.startswith("título"):
                level = int(re.sub(r"\D", "", style) or 2)
                lines.append(f"{'#' * min(4, max(1, level))} {p.text}")
            else:
                lines.append(p.text)
        return "\n\n".join(lines)
    return data.decode("utf-8", errors="replace")


def snippet(content: str, limit: int = 300) -> str:
    text = re.sub(r"[*_`>#|]", "", content)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text.rfind(" ", 0, limit)
    return text[: cut if cut > 0 else limit] + "…"
