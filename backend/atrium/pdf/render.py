"""PDF documents (payslip, letters, income statement) rendered with WeasyPrint from HTML/CSS.

Fonts are embedded TTFs (DejaVu Sans, present in the API image), so accents render
correctly and every glyph is embedded in the file.
"""

from __future__ import annotations

from datetime import date

from jinja2 import Environment, PackageLoader, select_autoescape

from atrium.branding import branding
from atrium.tools._util import d, money, month_label

_env = Environment(loader=PackageLoader("atrium.pdf", "templates"), autoescape=select_autoescape(["html"]))
_env.filters["money"] = money
_env.filters["date"] = lambda v: d(date.fromisoformat(v)) if isinstance(v, str) else d(v)
_env.filters["month"] = month_label


def render(template: str, **ctx) -> bytes:
    from weasyprint import HTML

    html = _env.get_template(template).render(brand=branding(), **ctx)
    return HTML(string=html).write_pdf()
