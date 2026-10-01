"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atrium.branding import branding
from atrium.config import get_settings


def create_app() -> FastAPI:
    from atrium.api import routes_core

    settings = get_settings()
    app = FastAPI(title=f"{branding()['productName']} API", version="0.1.0",
                  description="Governed conversational front door for employee services.")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(routes_core.router)
    return app
