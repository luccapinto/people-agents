"""LLM provider interface (OpenAI-compatible chat completions with tool calling)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class Completion:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    model: str = ""


class LLMProvider(Protocol):
    name: str
    model: str

    def complete(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        *,
        max_tokens: int,
        purpose: str,
        tool_choice: str | dict | None = None,
        context: dict | None = None,
    ) -> Completion:
        """``purpose`` (route/specialist/compose) and ``context`` are hints for the fake model;
        real providers ignore them."""
        ...


@dataclass
class Usage:
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0

    def add(self, c: Completion) -> None:
        self.model = c.model or self.model
        self.prompt_tokens += c.prompt_tokens
        self.completion_tokens += c.completion_tokens
        self.cost_usd += c.cost_usd

    def as_dict(self) -> dict:
        return {"model": self.model, "prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens,
                "cost_usd": round(self.cost_usd, 6)}
