"""Offline training of the intent classifier (``atrium train-router``). Needs numpy; the runtime
does not (see ``intent.py``).

Training data, all model-free and reproducible from the repository:

- ``shared/training/grammar.yaml``: templates per agent, written from the catalog, expanded with a
  fixed seed;
- the knowledge base's own FAQ questions (``Perguntas frequentes › ...`` sections), labelled with
  the agent that owns the knowledge base;
- the catalog's routing examples.

Writing noise is added (no accents, chat abbreviations, typos, greetings, context before the
question). Every message whose token overlap with any evaluation question (``shared/eval/*.yaml``)
reaches ``MAX_OVERLAP`` is dropped, so no evaluation phrase can be learned by heart. The result is
written to ``shared/training/routing-train.yaml`` (versioned; a test checks it is reproducible).

Multinomial logistic regression over the agents, class-balanced, L2, full-batch Adam; weights are
scaled by ``SCALE``, rounded to integers and pruned below ``PRUNE`` before export.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import unicodedata
from collections import Counter
from functools import lru_cache

import yaml

from atrium.config import REPO_ROOT
from atrium.runtime.intent import MODEL_PATH, SCALE, features
from atrium.runtime.nlu import normalize, tokens

GRAMMAR_PATH = REPO_ROOT / "shared/training/grammar.yaml"
TRAIN_PATH = REPO_ROOT / "shared/training/routing-train.yaml"
EVAL_DIR = REPO_ROOT / "shared/eval"
MAX_OVERLAP = 0.6
NGRAMS = (3, 4, 5)
HASH_BITS = 18
MIN_DF = 2
L2 = 1e-4
EPOCHS = 300
LEARNING_RATE = 0.05
PRUNE = 2  # |weight| below 0.02 is dropped
PER_TEMPLATE = 8
SEED = 13
VALIDATION_SHARE = 0.15
FAQ = "Perguntas frequentes ›"
# corporativo is shared by several agents: its documents are labelled one by one.
CORPORATE_DOCUMENTS = {"FAQ Geral": "concierge"}
CORPORATE_DEFAULT = "compliance"

ABBREVIATIONS = [("você", "vc"), ("para", "pra"), ("porque", "pq"), ("quando", "qnd"), ("quanto", "qto"), ("também", "tb"),
                 ("está", "tá"), ("estou", "tô"), ("por favor", "pfv"), ("tudo bem", "td bem"), ("mesmo", "msm")]
GREETINGS = ["oi, ", "bom dia! ", "olá, ", "e aí, ", "uma dúvida: ", "rapidinho: ", "pessoal, ", "ei, ", "boa tarde, "]
CONTEXTS = ["semana passada fiquei com uma dúvida: ", "tava vendo aqui e queria entender: ", "não achei no portal, então pergunto aqui: ",
            "me falaram uma coisa e quero confirmar: ", "antes que eu esqueça: "]
ENDINGS = ["?", "??", " por favor", " pfv", " obg", " valeu", "!"]


# ---------------------------------------------------------------------------------- grammar
def _parse(template: str, i: int = 0, stop: str = "") -> tuple[list, int]:
    """Template -> sequence of str | ("choice", [seq]) | ("opt", seq) | ("slot", name)."""
    seq: list = []
    buf = ""
    while i < len(template) and template[i] not in stop:
        ch = template[i]
        if ch in "([{":
            if buf:
                seq.append(buf)
                buf = ""
            if ch == "{":
                end = template.index("}", i)
                seq.append(("slot", template[i + 1:end]))
                i = end + 1
            elif ch == "[":
                inner, i = _parse(template, i + 1, "]")
                seq.append(("opt", inner))
                i += 1
            else:
                options = []
                i += 1
                while True:
                    inner, i = _parse(template, i, "|)")
                    options.append(inner)
                    if template[i] == ")":
                        i += 1
                        break
                    i += 1
                seq.append(("choice", options))
        else:
            buf += ch
            i += 1
    if buf:
        seq.append(buf)
    return seq, i


def _sample(seq: list, slots: dict[str, list[str]], rng: random.Random) -> str:
    out = []
    for part in seq:
        if isinstance(part, str):
            out.append(part)
        elif part[0] == "choice":
            out.append(_sample(rng.choice(part[1]), slots, rng))
        elif part[0] == "opt":
            out.append(_sample(part[1], slots, rng) if rng.random() < 0.5 else "")
        else:
            out.append(rng.choice(slots[part[1]]))
    return "".join(out)


def _tidy(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([?,!.])", r"\1", text)


def expand_grammar(grammar: dict, rng: random.Random) -> list[dict]:
    slots = grammar["slots"]
    out = []
    for agent, templates in grammar["agents"].items():
        for template in templates:
            seq = _parse(template)[0]
            seen: set[str] = set()
            for _ in range(PER_TEMPLATE * 6):
                text = _tidy(_sample(seq, slots, rng))
                if text and text not in seen:
                    seen.add(text)
                    if len(seen) >= PER_TEMPLATE:
                        break
            out += [{"agent": agent, "q": t, "source": "grammar"} for t in sorted(seen)]
    return out


# ---------------------------------------------------------------------------------- other sources
def faq_questions() -> list[dict]:
    agents = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
    owners: dict[str, list[str]] = {}
    for a in agents:
        for kb in a["knowledge"]:
            owners.setdefault(kb, []).append(a["id"])
    chunks = json.loads((REPO_ROOT / "shared/generated/kb-chunks.json").read_text())["chunks"]
    out = []
    for c in chunks:
        if FAQ not in c["section"]:
            continue
        if c["kb"] == "corporativo":
            agent = CORPORATE_DOCUMENTS.get(c["document"], CORPORATE_DEFAULT)
        elif len(owners.get(c["kb"], [])) == 1:
            agent = owners[c["kb"]][0]
        else:
            continue
        out.append({"agent": agent, "q": c["section"].split(FAQ, 1)[1].strip(), "source": "faq"})
    return out


def catalog_examples() -> list[dict]:
    agents = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
    return [{"agent": a["id"], "q": e, "source": "catalog"} for a in agents for e in (a.get("routing") or {}).get("examples", [])]


# ---------------------------------------------------------------------------------- noise
def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _typo(text: str, rng: random.Random) -> str:
    words = text.split(" ")
    long = [k for k, w in enumerate(words) if len(w) >= 5 and w.isalpha()]
    if not long:
        return text
    k = rng.choice(long)
    w = words[k]
    j = rng.randrange(1, len(w) - 1)
    op = rng.randrange(3)
    words[k] = w[:j] + w[j + 1:] if op == 0 else (w[:j] + w[j + 1] + w[j] + w[j + 2:] if op == 1 else w[:j] + w[j] + w[j:])
    return " ".join(words)


def noisy(text: str, rng: random.Random) -> str:
    out = text
    for long, short in ABBREVIATIONS:
        if rng.random() < 0.4:
            out = re.sub(rf"\b{long}\b", short, out, flags=re.IGNORECASE)
    if rng.random() < 0.5:
        out = out.lower()
    if rng.random() < 0.5:
        out = _strip_accents(out)
    if rng.random() < 0.3:
        out = _typo(out, rng)
    if rng.random() < 0.25:
        out = rng.choice(GREETINGS) + out
    elif rng.random() < 0.12:
        out = rng.choice(CONTEXTS) + out
    out = out.rstrip("?!.")
    if rng.random() < 0.6:
        out += rng.choice(ENDINGS)
    return _tidy(out)


# ---------------------------------------------------------------------------------- guard
def eval_questions() -> list[str]:
    """Every question of every evaluation file, whatever its section."""
    out: list[str] = []
    for path in sorted(EVAL_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text()) or {}
        for items in data.values():
            if isinstance(items, list):
                out += [i["q"] for i in items if isinstance(i, dict) and isinstance(i.get("q"), str)]
    return out


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def overlapping(messages: list[str]) -> list[tuple[str, str, float]]:
    """(training message, evaluation question, overlap) pairs at or above MAX_OVERLAP."""
    held = [(q, set(tokens(q))) for q in eval_questions()]
    out = []
    for m in messages:
        mt = set(tokens(m))
        out += [(m, q, round(jaccard(mt, qt), 2)) for q, qt in held if jaccard(mt, qt) >= MAX_OVERLAP]
    return out


# ---------------------------------------------------------------------------------- blind-set guard
BLIND_FILES = ("routing-blind.yaml", "routing-blind-2.yaml")
BLIND_OVERLAP = 0.4
BLIND_SHARED = 3
TEMPLATE_PROBES = 300


@lru_cache(maxsize=1)
def _entity_words() -> frozenset[str]:
    """Unit names and first names of the fictional company: entity values, not phrasing."""
    data = json.loads((REPO_ROOT / "shared/generated/dataset.json").read_text())
    words = {w for u in data["units"] for w in normalize(u["name"]).split()}
    words |= {normalize(e["name"].split()[0]) for e in data["employees"]}
    return frozenset(words)


def _trigrams(text: str) -> set[tuple[str, ...]]:
    """Word triples with at least two content words ("evento de seguranca", "saldo de ferias");
    unit and person names are entity values and do not count as content."""
    from atrium.runtime.nlu import STOPWORDS

    skip = STOPWORDS | _entity_words()
    words = normalize(text).split()
    return {tuple(words[i:i + 3]) for i in range(len(words) - 2) if sum(w not in skip for w in words[i:i + 3]) >= 2}


def _catalog_trigrams() -> set[tuple[str, ...]]:
    """Triples inside the catalog's own vocabulary (keywords, hints, lexicon, tool titles): domain
    terms such as "banco de horas" or "saldo de férias", which every phrasing needs."""
    lex = yaml.safe_load((REPO_ROOT / "shared/catalog/lexicon.yaml").read_text())
    agents = yaml.safe_load((REPO_ROOT / "shared/catalog/agents.yaml").read_text())["agents"]
    tools = yaml.safe_load((REPO_ROOT / "shared/catalog/tools.yaml").read_text())
    phrases = [p for c, vs in lex.get("synonyms", {}).items() for p in [c, *vs]]
    phrases += [k for a in agents for k in (a.get("routing") or {}).get("keywords", [])] + [a["name"] for a in agents]
    phrases += [h for t in tools.values() for h in t.get("hints", [])] + [t["title"] for t in tools.values()]
    out: set[tuple[str, ...]] = set()
    for p in phrases:
        words = normalize(p).split()
        out |= {tuple(words[i:i + 3]) for i in range(len(words) - 2)}
    return out


class BlindGuard:
    """Stricter than the overlap guard, for the two blind sets only: the grammar's author had seen
    them, so nothing may share three tokens at Jaccard >= 0.4 with a blind question, or a word triple
    beyond the catalog's own domain terms. (A short blind question such as "meu saldo de férias"
    shares its topic with any phrasing of the intent; three shared tokens are needed to call it a copy.)"""

    def __init__(self) -> None:
        questions = [i["q"] for name in BLIND_FILES for i in yaml.safe_load((EVAL_DIR / name).read_text())["questions"]]
        vocabulary = _catalog_trigrams()
        self.held = [(set(tokens(q)), _trigrams(q) - vocabulary) for q in questions]

    def violates(self, text: str) -> bool:
        t, g = set(tokens(text)), _trigrams(text)
        return any((len(t & ht) >= BLIND_SHARED and jaccard(t, ht) >= BLIND_OVERLAP) or g & hg for ht, hg in self.held)


def rejected_templates(grammar: dict) -> list[tuple[str, str, str]]:
    """(agent, template, one violating expansion) for templates with an expansion too close to a
    blind question (probed with a fixed seed)."""
    guard, rng, out = BlindGuard(), random.Random(SEED), []
    for agent, templates in grammar["agents"].items():
        for template in templates:
            seq = _parse(template)[0]
            bad = next((t for t in (_tidy(_sample(seq, grammar["slots"], rng)) for _ in range(TEMPLATE_PROBES)) if guard.violates(t)), None)
            if bad:
                out.append((agent, template, bad))
    return out


def build_training() -> tuple[list[dict], dict]:
    """The training set, deterministic from the repository."""
    rng = random.Random(SEED)
    grammar = yaml.safe_load(GRAMMAR_PATH.read_text())
    rejected = {(a, t) for a, t, _bad in rejected_templates(grammar)}
    usable = {"slots": grammar["slots"],
              "agents": {a: [t for t in ts if (a, t) not in rejected] for a, ts in grammar["agents"].items()}}
    base = expand_grammar(usable, rng) + faq_questions() + catalog_examples()
    items = []
    for item in base:
        items.append(item)
        if item["source"] != "catalog":
            items.append({**item, "q": noisy(item["q"], rng), "source": item["source"] + "+noise"})
    seen: set[str] = set()
    unique = []
    for item in items:
        key = normalize(item["q"])
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    leaked = {m for m, _q, _o in overlapping([i["q"] for i in unique])}
    guard = BlindGuard()
    near_blind = {i["q"] for i in unique if i["q"] not in leaked and guard.violates(i["q"])}
    kept = [i for i in unique if i["q"] not in leaked and i["q"] not in near_blind]
    report = {"templates": sum(len(ts) for ts in grammar["agents"].values()), "templates_rejected_near_blind": len(rejected),
              "candidates": len(items), "duplicates": len(items) - len(unique), "overlap_dropped": len(leaked),
              "near_blind_dropped": len(near_blind), "kept": len(kept),
              "per_agent": dict(sorted(Counter(i["agent"] for i in kept).items()))}
    return kept, report


def render_training(items: list[dict], report: dict) -> str:
    header = ("# Routing training set (round 3), generated by `atrium train-router` from shared/training/grammar.yaml,\n"
              "# the knowledge base's FAQ questions and the catalog examples, with writing noise. Guards: no message\n"
              "# overlaps an evaluation question (Jaccard of tokens >= 0.6), and nothing comes near the two blind sets\n"
              "# (templates and items; see BlindGuard). Do not edit by hand.\n")
    header += f"# {json.dumps(report, ensure_ascii=False)}\n"
    return header + yaml.safe_dump({"items": items}, allow_unicode=True, sort_keys=False, width=200)


# ---------------------------------------------------------------------------------- model
def _design(items: list[dict], vocab: dict[int, int] | None = None):
    import numpy as np

    rows = [features(i["q"], NGRAMS, HASH_BITS) for i in items]
    if vocab is None:
        df = Counter(f for r in rows for f in r)
        vocab = {f: k for k, f in enumerate(sorted(f for f, c in df.items() if c >= MIN_DF))}
    indices, values, indptr = [], [], [0]
    for r in rows:
        known = [vocab[f] for f in r if f in vocab]
        indices += known
        values += [1.0 / (len(r) ** 0.5)] * len(known)
        indptr.append(len(indices))
    return vocab, np.array(indices, dtype=np.int64), np.array(values), np.array(indptr, dtype=np.int64)


def _fit(design, labels: list[int], n_classes: int):
    import numpy as np

    vocab, indices, values, indptr = design
    n, v = len(labels), len(vocab)
    y = np.array(labels)
    counts = np.bincount(y, minlength=n_classes)
    weight = (n / (n_classes * np.maximum(counts, 1)))[y]
    row_of = np.repeat(np.arange(n), np.diff(indptr))
    w = np.zeros((v, n_classes))
    b = np.zeros(n_classes)
    m_w, v_w, m_b, v_b = np.zeros_like(w), np.zeros_like(w), np.zeros_like(b), np.zeros_like(b)
    onehot = np.zeros((n, n_classes))
    onehot[np.arange(n), y] = 1.0
    for step in range(1, EPOCHS + 1):
        z = np.zeros((n, n_classes))
        np.add.at(z, row_of, w[indices] * values[:, None])
        z += b
        z -= z.max(axis=1, keepdims=True)
        p = np.exp(z)
        p /= p.sum(axis=1, keepdims=True)
        g = (p - onehot) * weight[:, None] / weight.sum()
        gw = np.zeros_like(w)
        np.add.at(gw, indices, g[row_of] * values[:, None])
        gw += L2 * w
        gb = g.sum(axis=0)
        for param, grad, m, s in ((w, gw, m_w, v_w), (b, gb, m_b, v_b)):
            m *= 0.9
            m += 0.1 * grad
            s *= 0.999
            s += 0.001 * grad * grad
            param -= LEARNING_RATE * (m / (1 - 0.9 ** step)) / (np.sqrt(s / (1 - 0.999 ** step)) + 1e-8)
    return w, b


def build_model(items: list[dict], training_sha256: str) -> dict:
    import numpy as np

    agents = sorted({i["agent"] for i in items})
    design = _design(items)
    w, b = _fit(design, [agents.index(i["agent"]) for i in items], len(agents))
    q = np.rint(w * SCALE).astype(np.int64)
    q[np.abs(q) < PRUNE] = 0
    features_out, rows = [], []
    for f, k in sorted(design[0].items()):
        nz = np.nonzero(q[k])[0]
        if len(nz):
            features_out.append(int(f))
            rows.append([int(x) for ci in nz for x in (ci, q[k, ci])])
    return {"version": 1, "ngrams": list(NGRAMS), "hash_bits": HASH_BITS, "scale": SCALE, "training_sha256": training_sha256,
            "classes": agents, "bias": [int(x) for x in np.rint(b * SCALE)], "features": features_out, "rows": rows}


def validate(items: list[dict]) -> dict:
    """Agent accuracy on a held-out share of the training set (stratified by agent)."""
    from atrium.runtime.intent import parse_model

    rng = random.Random(SEED)
    by_agent: dict[str, list[dict]] = {}
    for i in items:
        by_agent.setdefault(i["agent"], []).append(i)
    train, held = [], []
    for key in sorted(by_agent):
        group = by_agent[key][:]
        rng.shuffle(group)
        cut = max(1, int(len(group) * VALIDATION_SHARE))
        held += group[:cut]
        train += group[cut:]
    model = parse_model(build_model(train, "validation"))
    ok = sum(max(model.scores(i["q"]).items(), key=lambda kv: (kv[1], kv[0]))[0] == i["agent"] for i in held)
    return {"held_out": len(held), "agent_accuracy": round(ok / len(held), 3)}


def train() -> dict:
    items, report = build_training()
    text = render_training(items, report)
    TRAIN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRAIN_PATH.write_text(text)
    report |= {"validation": validate(items)}
    model = build_model(items, hashlib.sha256(text.encode()).hexdigest())
    MODEL_PATH.write_text(json.dumps(model, separators=(",", ":")))
    report |= {"features": len(model["features"]), "model_bytes": MODEL_PATH.stat().st_size}
    return report


def committed_training() -> tuple[str, str]:
    """The committed training text and its hash (what the model was trained on)."""
    text = TRAIN_PATH.read_text()
    return text, hashlib.sha256(text.encode()).hexdigest()
