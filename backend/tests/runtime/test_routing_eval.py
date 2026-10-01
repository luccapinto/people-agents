"""Routing accuracy on the shared evaluation set (the same file the demo engine runs)."""

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.agents import life_events
from atrium.runtime.router import LexicalRouter

pytestmark = pytest.mark.db
EVAL = yaml.safe_load((REPO_ROOT / "shared/eval/routing.yaml").read_text())["questions"]
MIN_ACCURACY = 0.9


def matches(decision, expect) -> bool:
    if isinstance(expect, str) and expect.startswith("life_event:"):
        return decision.mode == "life_event" and decision.life_event == expect.split(":", 1)[1]
    wanted = [expect] if isinstance(expect, str) else list(expect)
    return all(a in decision.agents for a in wanted) and (len(wanted) > 1 or decision.agents[0] == wanted[0])


def test_eval_set_is_large_enough():
    assert len(EVAL) >= 40


def test_routing_accuracy(services, identity, capsys):
    hits, misses = 0, []
    cache = {}
    for item in EVAL:
        if item["persona"] not in cache:
            visible = services.agents.visible_for(identity(item["persona"]))
            cache[item["persona"]] = (LexicalRouter([a.profile() for a in visible], life_events()), [a.id for a in visible])
        router, ids = cache[item["persona"]]
        decision = router.route(item["q"], ids)
        if matches(decision, item["expect"]):
            hits += 1
        else:
            misses.append((item["q"], item["expect"], decision.mode, decision.agents))
    accuracy = hits / len(EVAL)
    with capsys.disabled():
        print(f"\nrouting accuracy: {hits}/{len(EVAL)} = {accuracy:.1%}")
        for m in misses:
            print("  miss:", m)
    assert accuracy >= MIN_ACCURACY
