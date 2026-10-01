# ADR 0012: PDF generation

Status: accepted (2026-09-30)

## Context
Payslips and letters must be real, downloadable PDFs with correct accents.

## Decision
Back-end: HTML/CSS templates rendered by WeasyPrint with embedded TTF fonts. Demo: `pdf-lib`
with the same embedded Inter font, built from the same structured data.

## Alternatives rejected
- ReportLab with core fonts: no embedded fonts, accent problems.
- Headless Chrome on the server: heavy dependency for the API image.
