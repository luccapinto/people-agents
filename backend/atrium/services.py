"""Composition root: builds every service once and wires them together."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from sqlalchemy import text

from atrium.adapters.reference.sql import SqlHRGateway
from atrium.authz.policy import PolicyEngine, PolicyStore
from atrium.config import Settings, get_settings
from atrium.db.engine import Database
from atrium.guardrails.pipeline import GuardrailPipeline
from atrium.kb.embeddings import get_embedder
from atrium.kb.service import KnowledgeService
from atrium.runtime.agents import AgentDirectory
from atrium.runtime.audit import AuditLog
from atrium.runtime.conversations import ConversationStore
from atrium.runtime.llm.base import LLMProvider
from atrium.runtime.llm.fake import FakeProvider
from atrium.runtime.proposals import ProposalService


def build_llm(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "fake":
        return FakeProvider()
    from atrium.runtime.llm.openai_compat import OpenAICompatibleProvider

    return OpenAICompatibleProvider(settings.llm_base_url, settings.api_key, settings.model, settings.llm_timeout_s)


@dataclass
class Services:
    settings: Settings
    db: Database
    llm: LLMProvider
    gateway: SqlHRGateway = field(init=False)
    policy: PolicyEngine = field(init=False)
    audit: AuditLog = field(init=False)
    agents: AgentDirectory = field(init=False)
    kb: KnowledgeService = field(init=False)
    conversations: ConversationStore = field(init=False)
    guardrails: GuardrailPipeline = field(init=False)
    proposals: ProposalService = field(init=False)
    _names: dict = field(default_factory=dict, init=False)
    _names_at: float = field(default=0.0, init=False)

    def __post_init__(self) -> None:
        self.gateway = SqlHRGateway(self.db)
        self.policy = PolicyEngine(PolicyStore(self.db))
        self.audit = AuditLog(self.db)
        self.agents = AgentDirectory(self.db)
        self.kb = KnowledgeService(self.db, get_embedder(self.settings.embeddings))
        self.conversations = ConversationStore(self.db)
        self.guardrails = GuardrailPipeline(self.policy.store, lambda: list(self._directory().values()))
        self.proposals = ProposalService(self)

    def _directory(self) -> dict[str, str]:
        if time.monotonic() - self._names_at > 60:
            with self.db.anonymous() as c:
                self._names = dict(c.execute(text("SELECT id, name FROM hr.directory_names()")).all())
            self._names_at = time.monotonic()
        return self._names

    def directory_name(self, employee_id: str) -> str | None:
        return self._directory().get(employee_id)


def build_services(settings: Settings | None = None, llm: LLMProvider | None = None) -> Services:
    settings = settings or get_settings()
    return Services(settings=settings, db=Database(settings.database_url), llm=llm or build_llm(settings))
