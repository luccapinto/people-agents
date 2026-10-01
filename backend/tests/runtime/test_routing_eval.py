"""Routing accuracy on a held-out evaluation set (the same file the demo engine replays)."""

from collections import defaultdict

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.agents import life_events
from atrium.runtime.nlu import tokens
from atrium.runtime.router import LexicalRouter

EVAL = yaml.safe_load((REPO_ROOT / "shared/eval/routing.yaml").read_text())["questions"]
AGENTS = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
EXAMPLES = [e for a in AGENTS for e in (a.get("routing") or {}).get("examples", [])]
MAX_OVERLAP = 0.6
# Regression floor for the deterministic lexical router (tests and the static demo only; a real
# model routes in production). Set from the first held-out measurement, never raised by tuning
# the profiles against this file.
MIN_ACCURACY = 0.75


def jaccard(a: str, b: str) -> float:
    x, y = set(tokens(a)), set(tokens(b))
    return len(x & y) / len(x | y) if x | y else 0.0


def matches(decision, expect) -> bool:
    if isinstance(expect, str) and expect.startswith("life_event:"):
        return decision.mode == "life_event" and decision.life_event == expect.split(":", 1)[1]
    if isinstance(expect, str) and expect.startswith("not:"):
        return expect.split(":", 1)[1] not in decision.agents
    wanted = [expect] if isinstance(expect, str) else list(expect)
    return all(a in decision.agents for a in wanted) and (len(wanted) > 1 or decision.agents[0] == wanted[0])


def test_eval_set_is_held_out_from_routing_examples():
    leaks = [(q["q"], e, round(jaccard(q["q"], e), 2)) for q in EVAL for e in EXAMPLES if jaccard(q["q"], e) >= MAX_OVERLAP]
    assert not leaks, leaks
    assert len(EVAL) >= 40


@pytest.mark.db
def test_routing_accuracy(services, identity, capsys):
    per_agent: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    misses, hits, cache = [], 0, {}
    for item in EVAL:
        if item["persona"] not in cache:
            visible = services.agents.visible_for(identity(item["persona"]))
            cache[item["persona"]] = (LexicalRouter([a.profile() for a in visible], life_events()), [a.id for a in visible])
        router, ids = cache[item["persona"]]
        decision = router.route(item["q"], ids)
        key = str(item["expect"])
        per_agent[key][1] += 1
        if matches(decision, item["expect"]):
            hits += 1
            per_agent[key][0] += 1
        else:
            misses.append((item["persona"], item["q"], item["expect"], decision.mode, decision.agents))
    accuracy = hits / len(EVAL)
    with capsys.disabled():
        print(f"\nrouting accuracy (held-out): {hits}/{len(EVAL)} = {accuracy:.1%}")
        for key in sorted(per_agent):
            ok, total = per_agent[key]
            print(f"  {key:<34} {ok}/{total}")
        for m in misses:
            print("  miss:", m)
    assert accuracy >= MIN_ACCURACY
