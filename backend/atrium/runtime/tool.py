"""Tools: the only way an agent touches company data.

A tool declares its risk and its subject mode. The runtime — not the model — decides who
the subject is (``self``: always the authenticated person; ``target``: a colleague the
policy engine must authorize), validates arguments with ``extra="forbid"``, and runs the
handler inside an identity-scoped transaction. Write and sensitive tools return a
proposal; their ``executor`` runs only after the user confirms.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

from atrium.authz.identity import IdentityContext
from atrium.authz.policy import Decision

if TYPE_CHECKING:
    from atrium.services import Services


class Risk(StrEnum):
    READ = "read"
    WRITE = "write"
    SENSITIVE = "sensitive"


class Args(BaseModel):
    """Base for tool parameters: unknown fields are rejected (no smuggled subject ids)."""

    model_config = ConfigDict(extra="forbid")


class NoArgs(Args):
    pass


@dataclass
class Card:
    type: str
    data: dict

    def as_dict(self) -> dict:
        return {"type": self.type, "data": self.data}


@dataclass
class Citation:
    id: str
    kb: str
    document: str
    section: str
    snippet: str
    source: str

    def as_dict(self) -> dict:
        return {"id": self.id, "kb": self.kb, "document": self.document, "section": self.section,
                "snippet": self.snippet, "source": self.source}


@dataclass
class ProposalDraft:
    """What a write tool wants to do; the runtime turns it into a confirmable proposal."""

    summary: str
    details: list[dict]
    args: dict
    subject_id: str | None = None
    tool: str | None = None  # execute another (write) tool on confirmation, e.g. extraction -> submit


@dataclass
class ToolResult:
    data: dict
    summary: str
    card: Card | None = None
    citations: list[Citation] = field(default_factory=list)
    proposal: ProposalDraft | None = None
    error: str | None = None
    decision: Decision | None = None
    # Follow-up phrases offered as chips ("Quero tirar férias de 21/12 a 04/01"): sent as a new
    # message when clicked, so they go through routing, authorization and confirmation again.
    suggestions: list[str] = field(default_factory=list)

    @classmethod
    def fail(cls, message: str, data: dict | None = None, card: Card | None = None, suggestions: list[str] | None = None) -> ToolResult:
        return cls(data={"erro": message, **(data or {})}, summary=message, error=message, card=card, suggestions=suggestions or [])


class ToolError(Exception):
    """A business rule refused the request (shown to the user, audited)."""


@dataclass
class ToolContext:
    identity: IdentityContext
    services: Services
    agent_id: str
    conversation_id: str | None = None
    subject_id: str | None = None
    knowledge: tuple[str, ...] = ()  # knowledge bases of the running agent spec (drafts included)
    # Whose data the turn asks for (runtime/subject.py): anything but "self" closes self-service tools.
    turn_subject: str = "self"

    @property
    def today(self) -> date:
        from atrium.clock import today

        return today()

    def hr(self) -> AbstractContextManager:
        """Systems of record, bound to the *authenticated* identity (RLS applies)."""
        return self.services.gateway.session(self.identity.employee_id)


Handler = Callable[[ToolContext, Any], ToolResult]
Executor = Callable[[ToolContext, dict], ToolResult]


@dataclass
class Tool:
    name: str
    title: str
    description: str
    risk: Risk
    subject: str  # self | target | none
    action: str  # policy engine action, e.g. self.vacation.read / team.vacation.read
    params: type[Args]
    handler: Handler
    executor: Executor | None = None
    roles: frozenset[str] = frozenset()  # required roles (e.g. manager)
    hints: tuple[str, ...] = ()

    def schema(self) -> dict:
        """OpenAI-compatible function schema. Self tools expose no subject parameter."""
        params = self.params.model_json_schema()
        params.pop("title", None)
        params.setdefault("properties", {})
        params["additionalProperties"] = False
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": params}}
