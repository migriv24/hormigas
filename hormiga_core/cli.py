"""
cli — the `hormiga` terminal surface:  python -m hormiga_core.cli [command...]

One-shot:     python -m hormiga_core.cli ls --tag "month:june"
              python -m hormiga_core.cli --json effect query images flier
REPL:         python -m hormiga_core.cli

Same dispatcher, same state file, same holidays as the Developer-tab console —
the terminal and the UI are two callers of one spine (UI ⇄ CLI parity by
construction). `help` lists the verb catalog.
"""
from __future__ import annotations

import json
import sys


def _get_repo():
    """Standalone repository accessor mirroring app.py's get_repo priority."""
    from core.settings import is_supabase_configured, get_supabase_url, get_supabase_anon_key
    if is_supabase_configured():
        from data.supabase_repository import SupabaseRestRepository
        return SupabaseRestRepository(get_supabase_url(), get_supabase_anon_key())
    from data.sheets_repository import SheetsRepository
    return SheetsRepository()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv
    if as_json:
        argv.remove("--json")

    from .engine import get_engine
    engine = get_engine(_get_repo)

    def run(command: str) -> int:
        res = engine.dispatch(command)
        if as_json:
            print(json.dumps(res, indent=2, default=str))
        else:
            for line in res.get("lines", []):
                print(line)
        return 0 if res.get("ok") else 1

    if argv:                                        # one-shot
        return run(" ".join(argv))

    print(f"hormiga · Void Core {getattr(engine, 'version', '?')} — "
          f"'help' for verbs, 'exit' to leave")     # REPL
    while True:
        try:
            command = input("hormiga> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not command:
            continue
        if command in ("exit", "quit"):
            return 0
        run(command)


if __name__ == "__main__":
    raise SystemExit(main())
