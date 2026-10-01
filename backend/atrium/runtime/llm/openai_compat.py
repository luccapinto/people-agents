"""Any OpenAI-compatible endpoint: OpenRouter, Azure OpenAI, vLLM, Ollama, ..."""

from __future__ import annotations

import json
import os

import httpx

from atrium.runtime.llm.base import Completion, ToolCall


class OpenAICompatibleProvider:
    name = "openai"

    def __init__(self, base_url: str, api_key: str, model: str, timeout_s: float = 60.0) -> None:
        if not api_key:
            raise ValueError("LLM API key missing (set OPENROUTER_API_KEY or LLM_API_KEY)")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._client = httpx.Client(timeout=timeout_s, headers={"Authorization": f"Bearer {api_key}",
                                                                "HTTP-Referer": "https://github.com/", "X-Title": "Atrium reference"})
        # Fallback prices (USD per million tokens) when the endpoint does not report cost.
        self.price_in = float(os.environ.get("LLM_PRICE_IN_PER_M", "0.3"))
        self.price_out = float(os.environ.get("LLM_PRICE_OUT_PER_M", "1.2"))

    def complete(self, messages, tools=None, *, max_tokens, purpose, tool_choice=None, context=None) -> Completion:
        body: dict = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.2,
                      "usage": {"include": True}}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice or "auto"
        last_exc: Exception | None = None
        for _attempt in range(2):
            try:
                r = self._client.post(f"{self.base_url}/chat/completions", json=body)
                r.raise_for_status()
                break
            except httpx.HTTPError as exc:
                last_exc = exc
        else:
            raise RuntimeError(f"LLM request failed: {last_exc}") from last_exc
        data = r.json()
        msg = data["choices"][0]["message"]
        calls = []
        for tc in msg.get("tool_calls") or []:
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"__invalid_json__": tc["function"].get("arguments")}
            calls.append(ToolCall(id=tc.get("id") or f"call_{len(calls)}", name=tc["function"]["name"], arguments=args))
        usage = data.get("usage") or {}
        pt, ct = int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
        cost = usage.get("cost")
        if cost is None:
            cost = (pt * self.price_in + ct * self.price_out) / 1_000_000
        return Completion(content=msg.get("content") or "", tool_calls=calls, prompt_tokens=pt, completion_tokens=ct,
                          cost_usd=float(cost), model=data.get("model", self.model))
