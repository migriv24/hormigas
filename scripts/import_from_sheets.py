"""
scripts/import_from_sheets.py — One-time import from Google Sheets → PostgreSQL.

Run this ONCE after setting up the PostgreSQL container to seed the database
with all existing contacts, events, presenters, and organizations.

It is safe to run multiple times — subsequent runs only add/update records,
they do not duplicate or delete anything.

Usage:
    python scripts/import_from_sheets.py
    python scripts/import_from_sheets.py --dry-run    # print counts, no DB writes
    python scripts/import_from_sheets.py --reset       # wipe tables first, then import
"""
import argparse
import io
import sys
from pathlib import Path

# Force UTF-8 output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Google Sheets data into PostgreSQL")
    parser.add_argument("--dry-run", action="store_true", help="Print counts only, no writes")
    parser.add_argument("--reset",   action="store_true",
                        help="DROP and recreate all tables before importing (data loss!)")
    args = parser.parse_args()

    # ── Setup ─────────────────────────────────────────────────────────────────
    from core.settings import get_settings, get_database_url
    settings = get_settings()

    db_url = get_database_url()
    if not db_url:
        print("✗  No database.url in settings.json. Add it first.")
        print('   Example: "database": {"url": "postgresql://hormiga:hormiga_dev@localhost:5432/hormiga"}')
        sys.exit(1)

    print(f"\nTarget database: {db_url}")
    print(f"Sheets ID:       {settings['google_sheet_id']}")

    # ── Create / reset tables ─────────────────────────────────────────────────
    from data.db.engine import engine
    from data.db.models import Base

    if args.reset:
        print("\n⚠  --reset: dropping all tables…")
        confirm = input("Type 'yes' to continue: ").strip().lower()
        if confirm != "yes":
            print("Aborted.")
            sys.exit(0)
        Base.metadata.drop_all(engine)
        print("  Tables dropped.")

    print("\nCreating tables (if not exist)…")
    Base.metadata.create_all(engine)
    print("  ✓ Tables ready")

    # ── Fetch from Sheets ─────────────────────────────────────────────────────
    from data.sheets_repository import SheetsRepository
    print("\n── Fetching from Google Sheets ──────────────────────────────────────")
    sheets = SheetsRepository()

    contacts   = sheets.get_contacts()
    events     = sheets.get_events()
    presenters = sheets.get_presenters()
    orgs       = sheets.get_organizations()

    print(f"  ✓  {len(contacts)} contacts")
    print(f"  ✓  {len(events)} events")
    print(f"  ✓  {len(presenters)} presenters")
    print(f"  ✓  {len(orgs)} organizations")

    if args.dry_run:
        print("\n── Dry run — no writes ──────────────────────────────────────────────")
        print("  Remove --dry-run to write to the database.")
        return

    # ── Insert into Postgres (explicit IDs = sheet row numbers) ───────────────
    print("\n── Writing to PostgreSQL ────────────────────────────────────────────")
    from sqlalchemy import text
    from data.db.engine import get_session
    from data.db.models import ContactRow, EventRow, PresenterRow, OrganizationRow

    def _upsert_contacts(s) -> int:
        count = 0
        for c in contacts:
            if c.row_index is None:
                continue
            existing = s.get(ContactRow, c.row_index)
            if existing is None:
                s.add(ContactRow.from_dataclass(c))
                count += 1
            else:
                existing.name = c.name; existing.organization = c.organization
                existing.title = c.title; existing.email = c.email
                existing.office_phone = c.office_phone; existing.work_cell = c.work_cell
                existing.website = c.website; existing.last_updated = c.last_updated
                existing.notes = c.notes; existing.receive_newsletter = c.receive_newsletter
                existing.image_url = c.image_url
        return count

    def _upsert_events(s) -> int:
        count = 0
        for e in events:
            if e.row_index is None:
                continue
            existing = s.get(EventRow, e.row_index)
            if existing is None:
                s.add(EventRow.from_dataclass(e))
                count += 1
            else:
                existing.title = e.title; existing.organization = e.organization
                existing.days = e.days; existing.start_time = e.start_time
                existing.end_time = e.end_time; existing.location = e.location
                existing.virtual_location = e.virtual_location
                existing.contact_email = e.contact_email
                existing.description = e.description; existing.icon_url = e.icon_url
        return count

    def _upsert_presenters(s) -> int:
        count = 0
        for p in presenters:
            if p.row_index is None:
                continue
            existing = s.get(PresenterRow, p.row_index)
            if existing is None:
                s.add(PresenterRow.from_dataclass(p))
                count += 1
            else:
                existing.name = p.name; existing.organization = p.organization
                existing.slides_link = p.slides_link
                existing.presentation_month = p.presentation_month
                existing.description = p.description
                existing.presentation_year = p.presentation_year
        return count

    def _upsert_orgs(s) -> int:
        count = 0
        for o in orgs:
            if not o.row_index:
                continue
            existing = s.get(OrganizationRow, o.row_index)
            if existing is None:
                s.add(OrganizationRow.from_dataclass(o))
                count += 1
            else:
                existing.name = o.name; existing.abbreviation = o.abbreviation
                existing.alternate_name = o.alternate_name
                existing.primary_contact = o.primary_contact
                existing.contact_email = o.contact_email; existing.website = o.website
                existing.location = o.location; existing.description = o.description
                existing.image_url = o.image_url
        return count

    def _reset_sequence(s, table: str) -> None:
        """Advance the auto-increment sequence past all manually-inserted IDs."""
        s.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE(MAX(id), 1)) FROM {table}"
        ))

    with get_session() as s:
        n_contacts   = _upsert_contacts(s)
        n_events     = _upsert_events(s)
        n_presenters = _upsert_presenters(s)
        n_orgs       = _upsert_orgs(s)
        # Reset sequences so new records auto-increment from the right place
        _reset_sequence(s, "contacts")
        _reset_sequence(s, "events")
        _reset_sequence(s, "presenters")
        _reset_sequence(s, "organizations")

    print(f"  ✓  {n_contacts}/{len(contacts)} contacts inserted (rest updated)")
    print(f"  ✓  {n_events}/{len(events)} events inserted (rest updated)")
    print(f"  ✓  {n_presenters}/{len(presenters)} presenters inserted (rest updated)")
    print(f"  ✓  {n_orgs}/{len(orgs)} orgs inserted (rest updated)")

    # ── Verify ────────────────────────────────────────────────────────────────
    print("\n── Verification ─────────────────────────────────────────────────────")
    with get_session() as s:
        from sqlalchemy import func, select
        for model, label in [(ContactRow, "contacts"), (EventRow, "events"),
                             (PresenterRow, "presenters"), (OrganizationRow, "organizations")]:
            count = s.execute(select(func.count()).select_from(model)).scalar()
            print(f"  {label}: {count} rows in DB")

    print("\n✅  Import complete. You can now set database.url in settings.json")
    print("   and restart the app to use PostgreSQL.\n")


if __name__ == "__main__":
    main()
