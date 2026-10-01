"""Routing accuracy on held-out evaluation sets (the same files the demo engine replays).

`routing.yaml` (64 paraphrases) was used to tune the round-2 router: the floor is the
requirement (90%). `routing-blind.yaml` was frozen before that tuning and is only measured.
Neither may leak into the router's vocabulary: no catalog phrase (lexicon, keywords, hints,
life-event keywords) of three or more content words may appear in, or be close to, any
evaluation question.
"""

from collections import defaultdict

import pytest
import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.agents import lexicon, life_events
from atrium.runtime.nlu import content_words, normalize, tokens
from atrium.runtime.router import LexicalRouter

EVAL_DIR = REPO_ROOT / "shared/eval"
EVAL = yaml.safe_load((EVAL_DIR / "routing.yaml").read_text())["questions"]
BLIND = yaml.safe_load((EVAL_DIR / "routing-blind.yaml").read_text())["questions"]
AGENTS = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
TOOLS = yaml.safe_load((REPO_ROOT / "shared/catalog/tools.yaml").read_text())
EXAMPLES = [e for a in AGENTS for e in (a.get("routing") or {}).get("examples", [])]
MAX_OVERLAP = 0.6
MIN_ACCURACY = 0.90
# Measured once on the blind set after the round-2 changes (28/40); a regression floor, not a target.
MIN_BLIND_ACCURACY = 0.70


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


def all_questions() -> list[str]:
    out = [q["q"] for q in EVAL + BLIND]
    for path in sorted(EVAL_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        for section in ("owner", "visitor", "questions", "attempts"):
            out += [q["q"] if isinstance(q, dict) else q for q in (data or {}).get(section, []) if path.name not in ("routing.yaml", "routing-blind.yaml")]
    return out


def catalog_phrases() -> list[tuple[str, str]]:
    lex = lexicon()
    out = [(f"lexicon:{c}", v) for c, vs in lex.get("synonyms", {}).items() for v in [c, *vs]]
    out += [(f"lexicon:{k}", p) for k in ("approval_by_me", "team_reference", "containers") for p in lex.get(k, [])]
    out += [(f"lexicon:general:{k}", p) for k, ps in lex.get("general", {}).items() for p in ps]
    out += [(f"agent:{a['id']}", k) for a in AGENTS for k in (a.get("routing") or {}).get("keywords", [])]
    out += [(f"tool:{name}", h) for name, t in TOOLS.items() for h in t.get("hints", [])]
    out += [(f"life_event:{k}", kw) for k, e in life_events().items() for kw in e["keywords"]]
    return out


def test_eval_set_is_held_out_from_routing_examples():
    leaks = [(q["q"], e, round(jaccard(q["q"], e), 2)) for q in EVAL + BLIND for e in EXAMPLES if jaccard(q["q"], e) >= MAX_OVERLAP]
    assert not leaks, leaks
    assert len(EVAL) >= 64 and len(BLIND) >= 40


def test_router_vocabulary_does_not_copy_evaluation_questions():
    questions = [(q, f" {normalize(q)} ") for q in all_questions()]
    leaks = []
    for source, phrase in catalog_phrases():
        if len(content_words(phrase)) < 3:
            continue
        n = f" {normalize(phrase)} "
        leaks += [(source, phrase, q) for q, nq in questions if n in nq or jaccard(phrase, q) >= MAX_OVERLAP]
    assert not leaks, leaks


def _accuracy(services, identity, items):
    per_agent: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    misses, hits, cache = [], 0, {}
    for item in items:
        if item["persona"] not in cache:
            visible = services.agents.visible_for(identity(item["persona"]))
            cache[item["persona"]] = (LexicalRouter([a.profile() for a in visible], life_events(), lexicon()), [a.id for a in visible])
        router, ids = cache[item["persona"]]
        decision = router.route(item["q"], ids)
        key = str(item["expect"])
        per_agent[key][1] += 1
        if matches(decision, item["expect"]):
            hits += 1
            per_agent[key][0] += 1
        else:
            misses.append((item["persona"], item["q"], item["expect"], decision.mode, decision.agents))
    return hits, per_agent, misses


@pytest.mark.db
@pytest.mark.parametrize("name,items,floor", [("held-out", EVAL, MIN_ACCURACY), ("blind", BLIND, MIN_BLIND_ACCURACY)])
def test_routing_accuracy(services, identity, capsys, name, items, floor):
    hits, per_agent, misses = _accuracy(services, identity, items)
    accuracy = hits / len(items)
    with capsys.disabled():
        print(f"\nrouting accuracy ({name}): {hits}/{len(items)} = {accuracy:.1%}")
        for key in sorted(per_agent):
            ok, total = per_agent[key]
            print(f"  {key:<34} {ok}/{total}")
        for m in misses:
            print("  miss:", m)
    assert accuracy >= floor
