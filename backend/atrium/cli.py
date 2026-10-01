"""Command line: ``uv run atrium <command>``."""

from __future__ import annotations

import argparse
import json
import sys


def cmd_generate(_args) -> None:
    from atrium.exports import export_all

    for path in export_all():
        print(f"wrote {path}")


def cmd_db_reset(args) -> None:
    from atrium.config import get_settings
    from atrium.db.migrate import reset

    reset(args.owner_url or get_settings().owner_database_url)
    print("schema reset")


def cmd_seed(args) -> None:
    from atrium.bootstrap import bootstrap
    from atrium.config import get_settings

    s = get_settings()
    print(json.dumps(bootstrap(args.owner_url or s.owner_database_url, args.app_url or s.database_url, reset_schema=args.reset)))


def cmd_serve(args) -> None:
    import uvicorn

    uvicorn.run("atrium.api.app:create_app", factory=True, host=args.host, port=args.port, reload=False)


def cmd_purge(args) -> None:
    from atrium.config import get_settings
    from atrium.retention import purge

    print(json.dumps(purge(args.owner_url or get_settings().owner_database_url)))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="atrium")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("generate", help="regenerate shared/generated/* from the Python sources").set_defaults(fn=cmd_generate)
    r = sub.add_parser("db-reset", help="drop and recreate the schemas")
    r.add_argument("--owner-url")
    r.set_defaults(fn=cmd_db_reset)
    s = sub.add_parser("seed", help="migrate and load the fictional company, agents and knowledge")
    s.add_argument("--owner-url")
    s.add_argument("--app-url")
    s.add_argument("--reset", action="store_true")
    s.set_defaults(fn=cmd_seed)
    v = sub.add_parser("serve", help="run the API")
    v.add_argument("--host", default="127.0.0.1")
    v.add_argument("--port", type=int, default=8765)
    v.set_defaults(fn=cmd_serve)
    g = sub.add_parser("purge", help="apply the retention policy to message content")
    g.add_argument("--owner-url")
    g.set_defaults(fn=cmd_purge)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main(sys.argv[1:])
