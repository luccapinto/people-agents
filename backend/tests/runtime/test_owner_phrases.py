"""The project owner's own phrases (shared/eval/owner-phrases.yaml) must work word for word.

The demo engine replays the same file (frontend/src/transport/demo/parity/owner.test.ts), so a
phrase that works here and not there, or the other way round, fails one of the two suites.
"""

from __future__ import annotations

import pytest
import yaml

from atrium.config import REPO_ROOT

pytestmark = pytest.mark.db

PHRASES = yaml.safe_load((REPO_ROOT / "shared/eval/owner-phrases.yaml").read_text())


def _groups() -> list[tuple[str, list[dict]]]:
    out: list[tuple[str, list[dict]]] = []
    for section in ("owner", "visitor"):
        for item in PHRASES[section]:
            key = item.get("conversation")
            if key and out and out[-1][0] == key:
                out[-1][1].append(item)
            else:
                out.append((key or item["q"], [item]))
    return out


def problems(turn, item: dict) -> list[str]:
    out = []
    route = turn.route or {}
    if "agents" in item and route.get("agents") != item["agents"]:
        out.append(f"agents {route.get('agents')} != {item['agents']} (mode {route.get('mode')})")
    if "mode" in item and route.get("mode") != item["mode"]:
        out.append(f"mode {route.get('mode')} != {item['mode']}")
    if "life_event" in item and route.get("life_event") != item["life_event"]:
        out.append(f"life_event {route.get('life_event')} != {item['life_event']}")
    ran = {(t["tool"], t["status"]) for t in turn.tools}
    for want in item.get("tools", []):
        name, _, status = want.partition(":")
        if not any(n == name and (not status or s == status) for n, s in ran):
            out.append(f"tool {want} missing (ran {sorted(ran)})")
    shown = [c["type"] for c in turn.cards]
    for card in item.get("cards", []):
        if card not in shown:
            out.append(f"card {card} missing (shown {shown})")
    proposed = [p["tool"] for p in turn.proposals]
    for tool in item.get("proposals", []):
        if tool not in proposed:
            out.append(f"proposal {tool} missing (proposed {proposed})")
    if item.get("step_up") and not (turn.proposals and turn.proposals[0]["step_up_required"]):
        out.append("first proposal does not require step-up")
    cites = item.get("citations")
    if cites is True and not turn.citations:
        out.append("no citation")
    elif isinstance(cites, list) and not {c["kb"] for c in turn.citations} & set(cites):
        out.append(f"citations {[c['kb'] for c in turn.citations]} not from {cites}")
    if item.get("no_citations") and turn.citations:
        out.append(f"cited {[c['document'] for c in turn.citations]}")
    if len([e for e in turn.events if e["event"] == "suggestions"]) < (1 if item.get("suggestions") else 0):
        out.append("no suggestions")
    g = item.get("guardrail")
    if g and not any(x["name"] == g["name"] and x["outcome"] == g["outcome"] for x in turn.guardrails):
        out.append(f"guardrail {g} missing ({[(x['name'], x['outcome']) for x in turn.guardrails]})")
    for snippet in item.get("text", []):
        if snippet.lower() not in turn.text.lower():
            out.append(f"text lacks {snippet!r}: {turn.text[:160]!r}")
    return out


@pytest.mark.parametrize("group", [items for _key, items in _groups()], ids=[key[:60] for key, _ in _groups()])
def test_owner_phrase(chat, group):
    conversation = None
    failures = []
    for item in group:
        turn = chat(item["persona"], item["q"], conversation_id=conversation)
        conversation = turn.conversation_id if item.get("conversation") else None
        failures += [f"{item['q']!r}: {p}" for p in problems(turn, item)]
    assert not failures, "\n".join(failures)
