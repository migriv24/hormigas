"""
backup.py — Hormiga full data backup and restore utility.

Usage:
    python backup.py                          # create backup → backups/
    python backup.py --restore <file.json>    # restore from backup
    python backup.py --no-sheets              # skip Google Sheets fetch
    python backup.py --list                   # list available backups

What gets backed up:
    LOCAL JSON STORES (always):
      images, jobs, tags, graph, user_profile,
      contacts_meta, events_meta, presenter_meta,
      presets, all projects, all templates

    GOOGLE SHEETS (live fetch, requires credentials):
      contacts, events, presenters, organizations

What does NOT get backed up:
    settings.json  (contains API keys — back up manually if needed)
    __pycache__, .venv, etc.

Restoring:
    Local JSON stores are overwritten with backup contents.
    Google Sheets data is written back to backups/sheets_<timestamp>.json
    for reference, but NOT pushed to the live sheet (too risky).
"""

import argparse
import io
import json
import sys
from datetime import datetime
from pathlib import Path

# Force UTF-8 output on Windows so box-drawing characters print correctly
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).parent
DATA        = ROOT / "data"
BACKUPS_DIR = ROOT / "backups"

_LOCAL_FILES: dict[str, Path] = {
    "images":          DATA / "images.json",
    "jobs":            DATA / "jobs.json",
    "tags":            DATA / "tags.json",
    "graph":           DATA / "graph.json",
    "user_profile":    DATA / "user_profile.json",
    "contacts_meta":   DATA / "contacts_meta.json",
    "events_meta":     DATA / "events_meta.json",
    "presenter_meta":  DATA / "presenter_meta.json",
    "presets":         DATA / "presets.json",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _read_json(path: Path) -> object:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  ⚠  Could not parse {path.name}: {e}")
        return None


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

# ── Backup ────────────────────────────────────────────────────────────────────

def _collect_local() -> dict:
    """Read every local JSON store into a dict keyed by store name."""
    stores = {}
    for name, path in _LOCAL_FILES.items():
        data = _read_json(path)
        stores[name] = data
        status = "✓" if data is not None else "— (not found)"
        print(f"  {status}  {path.name}")
    return stores


def _collect_projects() -> dict[str, object]:
    projects_dir = DATA / "projects"
    out = {}
    for f in sorted(projects_dir.glob("*.json")):
        data = _read_json(f)
        if data is not None:
            out[f.stem] = data
            print(f"  ✓  projects/{f.name}")
    return out


def _collect_templates() -> dict[str, object]:
    templates_dir = DATA / "templates"
    out = {}
    for f in sorted(templates_dir.glob("*.json")):
        data = _read_json(f)
        if data is not None:
            out[f.stem] = data
            print(f"  ✓  templates/{f.name}")
    return out


def _collect_sheets() -> dict | None:
    """Fetch live data from Google Sheets. Returns None on failure."""
    try:
        sys.path.insert(0, str(ROOT))
        from core.settings import get_settings
        from data.sheets_repository import SheetsRepository

        print("  Connecting to Google Sheets…")
        settings = get_settings()
        repo = SheetsRepository()

        contacts   = [c.__dict__ if hasattr(c, '__dict__') else dict(c) for c in repo.get_contacts()]
        events     = [e.__dict__ if hasattr(e, '__dict__') else dict(e) for e in repo.get_events()]
        presenters = [p.__dict__ if hasattr(p, '__dict__') else dict(p) for p in repo.get_presenters()]
        orgs       = [o.__dict__ if hasattr(o, '__dict__') else dict(o) for o in repo.get_organizations()]

        print(f"  ✓  {len(contacts)} contacts, {len(events)} events, "
              f"{len(presenters)} presenters, {len(orgs)} orgs")
        return {
            "contacts":   contacts,
            "events":     events,
            "presenters": presenters,
            "organizations": orgs,
        }
    except Exception as e:
        print(f"  ✗  Google Sheets fetch failed: {e}")
        print("     (Backup continues without sheet data — use --no-sheets to suppress this warning)")
        return None


def do_backup(include_sheets: bool = True) -> Path:
    BACKUPS_DIR.mkdir(exist_ok=True)
    stamp = _stamp()

    print("\n── Local stores ─────────────────────────────────────────────────")
    local   = _collect_local()

    print("\n── Projects ─────────────────────────────────────────────────────")
    projects = _collect_projects()

    print("\n── Templates ────────────────────────────────────────────────────")
    templates = _collect_templates()

    sheets = None
    if include_sheets:
        print("\n── Google Sheets (live) ─────────────────────────────────────────")
        sheets = _collect_sheets()

    bundle = {
        "_backup_version": 1,
        "_created_at":     datetime.now().isoformat(),
        "_hormiga_note":   (
            "This file was created by backup.py. "
            "Restore with: python backup.py --restore <this file>"
        ),
        "local":     local,
        "projects":  projects,
        "templates": templates,
        "sheets":    sheets,   # None if skipped or failed
    }

    out_path = BACKUPS_DIR / f"hormiga_backup_{stamp}.json"
    _write_json(out_path, bundle)

    size_kb = out_path.stat().st_size / 1024
    print(f"\n✅  Backup saved → {out_path}  ({size_kb:.1f} KB)")
    print(   "   settings.json was NOT included (contains API keys).")
    print(   "   Back it up manually if needed.\n")
    return out_path

# ── Restore ───────────────────────────────────────────────────────────────────

def do_restore(backup_path: Path) -> None:
    if not backup_path.exists():
        print(f"✗  File not found: {backup_path}")
        sys.exit(1)

    bundle = _read_json(backup_path)
    if not isinstance(bundle, dict) or bundle.get("_backup_version") != 1:
        print("✗  This doesn't look like a valid Hormiga backup file.")
        sys.exit(1)

    created = bundle.get("_created_at", "unknown time")
    print(f"\nRestoring from backup created: {created}")
    print("This will OVERWRITE your current local data files.")
    confirm = input("Type 'yes' to continue: ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        sys.exit(0)

    # ── Local stores ──────────────────────────────────────────────────────────
    print("\n── Local stores ─────────────────────────────────────────────────")
    local = bundle.get("local", {})
    for name, path in _LOCAL_FILES.items():
        data = local.get(name)
        if data is None:
            print(f"  —  {path.name}  (not in backup, skipped)")
            continue
        _write_json(path, data)
        print(f"  ✓  {path.name}")

    # ── Projects ──────────────────────────────────────────────────────────────
    print("\n── Projects ─────────────────────────────────────────────────────")
    projects_dir = DATA / "projects"
    projects_dir.mkdir(exist_ok=True)
    for slug, data in bundle.get("projects", {}).items():
        out = projects_dir / f"{slug}.json"
        _write_json(out, data)
        print(f"  ✓  projects/{slug}.json")

    # ── Templates ─────────────────────────────────────────────────────────────
    print("\n── Templates ────────────────────────────────────────────────────")
    templates_dir = DATA / "templates"
    templates_dir.mkdir(exist_ok=True)
    for slug, data in bundle.get("templates", {}).items():
        out = templates_dir / f"{slug}.json"
        _write_json(out, data)
        print(f"  ✓  templates/{slug}.json")

    # ── Sheets data (reference only) ──────────────────────────────────────────
    sheets = bundle.get("sheets")
    if sheets:
        stamp = _stamp()
        ref_path = BACKUPS_DIR / f"sheets_reference_{stamp}.json"
        BACKUPS_DIR.mkdir(exist_ok=True)
        _write_json(ref_path, sheets)
        print(f"\n── Google Sheets data ───────────────────────────────────────────")
        print(f"  ℹ  Sheet data from backup saved to {ref_path}")
        print(f"     It was NOT pushed to Google Sheets (too risky).")
        print(f"     If you need to restore sheet rows, do it manually from that file.")

    print("\n✅  Restore complete.\n")

# ── List ──────────────────────────────────────────────────────────────────────

def do_list() -> None:
    BACKUPS_DIR.mkdir(exist_ok=True)
    files = sorted(BACKUPS_DIR.glob("hormiga_backup_*.json"), reverse=True)
    if not files:
        print("No backups found in backups/")
        return
    print(f"\n{'File':<45} {'Size':>8}  Created")
    print("─" * 70)
    for f in files:
        bundle = _read_json(f)
        created = bundle.get("_created_at", "?") if isinstance(bundle, dict) else "?"
        print(f"  {f.name:<43} {f.stat().st_size/1024:>6.1f}K  {created}")
    print()

# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hormiga backup & restore utility",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--restore",    metavar="FILE", help="Restore from a backup file")
    parser.add_argument("--no-sheets",  action="store_true", help="Skip Google Sheets fetch")
    parser.add_argument("--list",       action="store_true", help="List available backups")
    args = parser.parse_args()

    if args.list:
        do_list()
    elif args.restore:
        do_restore(Path(args.restore))
    else:
        do_backup(include_sheets=not args.no_sheets)


if __name__ == "__main__":
    main()
