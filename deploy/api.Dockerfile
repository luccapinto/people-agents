# API image: FastAPI + WeasyPrint (Pango) + optional fastembed.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libcairo2 libgdk-pixbuf-2.0-0 fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --extra embeddings --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev --extra embeddings
COPY config/ /app/config/
COPY shared/ /app/shared/
COPY content/ /app/content/
EXPOSE 8765
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD curl -fsS http://127.0.0.1:8765/api/health || exit 1
# Migrate + seed the fictional company (idempotent reset for the reference deployment), then serve.
CMD ["sh", "-c", "uv run --no-sync atrium seed --reset && uv run --no-sync atrium serve --host 0.0.0.0 --port 8765"]
