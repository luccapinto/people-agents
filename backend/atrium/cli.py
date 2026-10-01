"""Command line: ``uv run atrium <command>``."""

from __future__ import annotations

import argparse
import json
import sys


def cmd_generate(_args) -> None:
    from atrium.exports import export_all

    for path in export_all():
        print(f"wrote {path}")


def cmd_goldens(_args) -> None:
    from atrium.exports import export_goldens

    print(f"wrote {export_goldens()}")


def _owner_url(args) -> str:
    from atrium.config import MaintenanceSettings

    return args.owner_url or MaintenanceSettings().owner_database_url


def cmd_db_reset(args) -> None:
    from atrium.db.migrate import reset

    reset(_owner_url(args))
    print("schema reset")


def cmd_seed(args) -> None:
    from atrium.bootstrap import bootstrap, is_seeded
    from atrium.config import get_settings

    owner = _owner_url(args)
    if args.if_empty and is_seeded(owner):
        print(json.dumps({"skipped": "database already seeded"}))
        return
    print(json.dumps(bootstrap(owner, args.app_url or get_settings().database_url, reset_schema=args.reset)))


def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run("atrium.api.app:create_app", factory=True, host=args.host, port=args.port, reload=False)


def cmd_purge(args) -> None:
    from atrium.retention import purge

    print(json.dumps(purge(_owner_url(args))))


def cmd_eval_retrieval(_args) -> None:
    """Hit@3 of shared/eval/retrieval.yaml against the configured database and embedder."""
    import yaml

    from atrium.authz.identity import load_identity
    from atrium.config import REPO_ROOT
    from atrium.services import build_services

    s = build_services()
    data = json.loads((REPO_ROOT / "shared/generated/dataset.json").read_text())
    persona = {p["key"]: p["employee_id"] for p in data["personas"]}
    who = {"lideranca": "gestora", "people-analytics": "hrbp"}
    items = yaml.safe_load((REPO_ROOT / "shared/eval/retrieval.yaml").read_text())["queries"]
    hits = 0
    for item in items:
        key = next((who[k] for k in item["kb"] if k in who), "colaborador")
        results = s.kb.search(load_identity(s.db, persona[key]), item["q"], item["kb"], limit=3)
        ok = any(r.source.endswith(item["doc"]) for r in results)
        hits += ok
        print(("ok  " if ok else "MISS"), item["q"])
    print(f"hit@3 with {s.kb.embedder.name}: {hits}/{len(items)} = {hits / len(items):.0%}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="atrium")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("generate", help="regenerate shared/generated/{dataset,catalog}.json").set_defaults(fn=cmd_generate)
    sub.add_parser("goldens", help="replay golden scenarios on the test database -> shared/generated/goldens.json").set_defaults(fn=cmd_goldens)
    r = sub.add_parser("db-reset", help="drop and recreate the schemas")
    r.add_argument("--owner-url")
    r.set_defaults(fn=cmd_db_reset)
    s = sub.add_parser("seed", help="migrate and load the fictional company, agents and knowledge")
    s.add_argument("--owner-url")
    s.add_argument("--app-url")
    s.add_argument("--reset", action="store_true")
    s.add_argument("--if-empty", action="store_true", help="migrate and seed only when the company is not loaded yet")
    s.set_defaults(fn=cmd_seed)
    v = sub.add_parser("serve", help="run the API")
    v.add_argument("--host", default="127.0.0.1")
    v.add_argument("--port", type=int, default=8765)
    v.set_defaults(fn=cmd_serve)
    g = sub.add_parser("purge", help="apply the retention policy to message content")
    g.add_argument("--owner-url")
    g.set_defaults(fn=cmd_purge)
    sub.add_parser("eval-retrieval", help="retrieval hit@3 on shared/eval/retrieval.yaml").set_defaults(fn=cmd_eval_retrieval)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main(sys.argv[1:])
