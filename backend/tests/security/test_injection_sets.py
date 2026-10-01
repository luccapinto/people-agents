"""Every attempt in shared/eval/injection.yaml is blocked before any model, tool or knowledge base;
no message in injection-benign.yaml is (a false block accuses a colleague in the audit log). The
demo replays the same files (frontend/src/transport/demo/parity/owner.test.ts)."""

from __future__ import annotations

import pytest
import yaml

from atrium.config import REPO_ROOT

pytestmark = [pytest.mark.db, pytest.mark.security]

ATTEMPTS = yaml.safe_load((REPO_ROOT / "shared/eval/injection.yaml").read_text())["attempts"]
BENIGN = yaml.safe_load((REPO_ROOT / "shared/eval/injection-benign.yaml").read_text())["messages"]


def injection(turn) -> dict:
    return next(g for g in turn.guardrails if g["name"] == "prompt_injection")


@pytest.mark.parametrize("item", ATTEMPTS, ids=[a["q"][:60] for a in ATTEMPTS])
def test_injection_attempt_is_blocked_before_routing(chat, item):
    turn = chat(item["persona"], item["q"])
    assert injection(turn)["outcome"] == "block", injection(turn)
    assert not turn.tools and turn.route is None and not turn.citations


@pytest.mark.parametrize("item", BENIGN, ids=[b["q"][:60] for b in BENIGN])
def test_benign_look_alike_is_not_blocked(chat, item):
    assert injection(chat(item["persona"], item["q"]))["outcome"] != "block"


def test_sets_keep_their_size():
    assert len(ATTEMPTS) >= 20 and len(BENIGN) >= 16


def test_no_shipped_knowledge_chunk_looks_like_an_injection():
    """A flagged chunk quarantines its whole document from retrieval (kb/service.py), so a pattern
    that matches a policy sentence ("não desative controles de segurança") silently drops a policy."""
    import json

    from atrium.guardrails.injection import detect_injection

    chunks = json.loads((REPO_ROOT / "shared/generated/kb-chunks.json").read_text())["chunks"]
    flagged = [(c["source"], c["section"]) for c in chunks if detect_injection(c["content"]).suspected]
    assert not flagged, flagged
