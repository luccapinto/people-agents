"""Runtime settings, read from the environment (see .env.example)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = Field(
        "postgresql+psycopg://atrium_app:atrium_app@localhost:55432/atrium", alias="ATRIUM_DATABASE_URL"
    )
    owner_database_url: str = Field(
        "postgresql+psycopg://atrium_owner:atrium_owner@localhost:55432/atrium", alias="ATRIUM_OWNER_DATABASE_URL"
    )
    dev_jwt_secret: str = Field("change-me-dev-only", alias="ATRIUM_DEV_JWT_SECRET")
    dev_idp_enabled: bool = Field(True, alias="ATRIUM_DEV_IDP")
    oidc_issuer: str = Field("", alias="ATRIUM_OIDC_ISSUER")
    oidc_audience: str = Field("", alias="ATRIUM_OIDC_AUDIENCE")

    llm_provider: str = Field("fake", alias="ATRIUM_LLM_PROVIDER")
    llm_base_url: str = Field("https://openrouter.ai/api/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    openrouter_api_key: str = Field("", alias="OPENROUTER_API_KEY")
    llm_model: str = Field("", alias="LLM_MODEL")
    openrouter_model: str = Field("deepseek/deepseek-v4.1-flash", alias="OPENROUTER_MODEL")
    llm_max_tokens: int = Field(900, alias="LLM_MAX_TOKENS")
    llm_timeout_s: float = Field(60.0, alias="LLM_TIMEOUT_S")

    embeddings: str = Field("hash", alias="ATRIUM_EMBEDDINGS")
    cors_origins: str = Field("http://localhost:5175,http://127.0.0.1:5175", alias="ATRIUM_CORS_ORIGINS")

    @property
    def api_key(self) -> str:
        return self.llm_api_key or self.openrouter_api_key

    @property
    def model(self) -> str:
        return self.llm_model or self.openrouter_model


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
