"""PostgreSQL implementation of BaseRepository using SQLAlchemy ORM.

This is the primary data store for Hormiga when a database.url is
configured in settings.json.  Google Sheets is kept as an external
input channel (people edit their own rows there); the pull-sheet sync
imports those changes into this database.

Architecture notes:
  - row_index on dataclasses maps 1-to-1 to the integer primary key (id)
    in each table.  The import script preserves original sheet row numbers
    as IDs so contacts_meta / events_meta JSON files stay consistent.
  - The in-memory cache (data.cache) still wraps all read calls to avoid
    hammering the database on every request.  Writes invalidate the cache.
  - Every write is reflected in the activity_log table automatically.
"""
import json

from sqlalchemy import select, text

from core.exceptions import AppError
from core.logger import get_logger
from data.cache import cache
from data.db.engine import get_session
from data.db.models import (
    ActivityLog, ContactRow, EventRow, OrganizationRow, PresenterRow,
)
from data.repository import BaseRepository
from schemas.contact import Contact
from schemas.event import Event
from schemas.organization import Organization
from schemas.presenter import Presenter

logger = get_logger("postgres")


class PostgresRepository(BaseRepository):

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _log(self, session, entity_type: str, entity_id: int | None,
             action: str, name: str = "", detail: str = "") -> None:
        session.add(ActivityLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            entity_name=name,
            detail=detail,
        ))

    # ── Contacts ──────────────────────────────────────────────────────────────

    def get_contacts(self) -> list[Contact]:
        hit = cache.get("contacts")
        if hit is not None:
            return hit
        with get_session() as s:
            rows = s.execute(select(ContactRow).order_by(ContactRow.id)).scalars().all()
            result = [r.to_dataclass() for r in rows]
        cache.set("contacts", result)
        logger.info(f"Loaded {len(result)} contacts from DB")
        return result

    def add_contact(self, contact: Contact) -> Contact:
        with get_session() as s:
            row = ContactRow.from_dataclass(contact)
            row.id = None  # let DB assign new id
            s.add(row)
            s.flush()
            contact.row_index = row.id
            self._log(s, "contact", row.id, "create", contact.name)
        cache.invalidate("contacts")
        logger.info(f"Added contact '{contact.name}' → id {contact.row_index}")
        return contact

    def update_contact(self, contact: Contact) -> None:
        if contact.row_index is None:
            raise AppError("update_contact requires row_index")
        with get_session() as s:
            row = s.get(ContactRow, contact.row_index)
            if row is None:
                raise AppError(f"Contact id={contact.row_index} not found")
            row.name = contact.name
            row.organization = contact.organization
            row.title = contact.title
            row.email = contact.email
            row.office_phone = contact.office_phone
            row.work_cell = contact.work_cell
            row.website = contact.website
            row.last_updated = contact.last_updated
            row.notes = contact.notes
            row.receive_newsletter = contact.receive_newsletter
            row.image_url = contact.image_url
            self._log(s, "contact", contact.row_index, "update", contact.name)
        cache.invalidate("contacts")
        logger.info(f"Updated contact '{contact.name}' id={contact.row_index}")

    # ── Events ────────────────────────────────────────────────────────────────

    def get_events(self) -> list[Event]:
        hit = cache.get("events")
        if hit is not None:
            return hit
        with get_session() as s:
            rows = s.execute(select(EventRow).order_by(EventRow.id)).scalars().all()
            result = [r.to_dataclass() for r in rows]
        cache.set("events", result)
        logger.info(f"Loaded {len(result)} events from DB")
        return result

    def add_event(self, event: Event) -> Event:
        with get_session() as s:
            row = EventRow.from_dataclass(event)
            row.id = None
            s.add(row)
            s.flush()
            event.row_index = row.id
            self._log(s, "event", row.id, "create", event.title)
        cache.invalidate("events")
        logger.info(f"Added event '{event.title}' → id {event.row_index}")
        return event

    def update_event(self, event: Event) -> None:
        if event.row_index is None:
            raise AppError("update_event requires row_index")
        with get_session() as s:
            row = s.get(EventRow, event.row_index)
            if row is None:
                raise AppError(f"Event id={event.row_index} not found")
            row.title = event.title
            row.organization = event.organization
            row.days = event.days
            row.start_time = event.start_time
            row.end_time = event.end_time
            row.location = event.location
            row.virtual_location = event.virtual_location
            row.contact_email = event.contact_email
            row.description = event.description
            row.icon_url = event.icon_url
            row.color = event.color
            self._log(s, "event", event.row_index, "update", event.title)
        cache.invalidate("events")
        logger.info(f"Updated event '{event.title}' id={event.row_index}")

    def delete_event(self, event: Event) -> None:
        if event.row_index is None:
            raise AppError("delete_event requires row_index")
        with get_session() as s:
            row = s.get(EventRow, event.row_index)
            if row:
                s.delete(row)
                self._log(s, "event", event.row_index, "delete", event.title)
        cache.invalidate("events")
        logger.info(f"Deleted event '{event.title}' id={event.row_index}")

    # ── Presenters ────────────────────────────────────────────────────────────

    def get_presenters(self) -> list[Presenter]:
        hit = cache.get("presenters")
        if hit is not None:
            return hit
        with get_session() as s:
            rows = s.execute(select(PresenterRow).order_by(PresenterRow.id)).scalars().all()
            result = [r.to_dataclass() for r in rows]
        cache.set("presenters", result)
        logger.info(f"Loaded {len(result)} presenters from DB")
        return result

    def add_presenter(self, presenter: Presenter) -> Presenter:
        with get_session() as s:
            row = PresenterRow.from_dataclass(presenter)
            row.id = None
            s.add(row)
            s.flush()
            presenter.row_index = row.id
            self._log(s, "presenter", row.id, "create", presenter.name)
        cache.invalidate("presenters")
        logger.info(f"Added presenter '{presenter.name}' → id {presenter.row_index}")
        return presenter

    def update_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise AppError("update_presenter requires row_index")
        with get_session() as s:
            row = s.get(PresenterRow, presenter.row_index)
            if row is None:
                raise AppError(f"Presenter id={presenter.row_index} not found")
            row.name = presenter.name
            row.organization = presenter.organization
            row.slides_link = presenter.slides_link
            row.presentation_month = presenter.presentation_month
            row.description = presenter.description
            row.presentation_year = presenter.presentation_year
            self._log(s, "presenter", presenter.row_index, "update", presenter.name)
        cache.invalidate("presenters")
        logger.info(f"Updated presenter '{presenter.name}' id={presenter.row_index}")

    def delete_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise AppError("delete_presenter requires row_index")
        with get_session() as s:
            row = s.get(PresenterRow, presenter.row_index)
            if row:
                s.delete(row)
                self._log(s, "presenter", presenter.row_index, "delete", presenter.name)
        cache.invalidate("presenters")
        logger.info(f"Deleted presenter '{presenter.name}' id={presenter.row_index}")

    # ── Organizations ─────────────────────────────────────────────────────────

    def get_organizations(self) -> list[Organization]:
        hit = cache.get("organizations")
        if hit is not None:
            return hit
        with get_session() as s:
            rows = s.execute(select(OrganizationRow).order_by(OrganizationRow.name)).scalars().all()
            result = [r.to_dataclass() for r in rows]
        cache.set("organizations", result)
        logger.info(f"Loaded {len(result)} organizations from DB")
        return result

    def add_organization(self, org: Organization) -> Organization:
        with get_session() as s:
            row = OrganizationRow.from_dataclass(org)
            row.id = None
            s.add(row)
            s.flush()
            org.row_index = row.id
            self._log(s, "organization", row.id, "create", org.name)
        cache.invalidate("organizations")
        logger.info(f"Added org '{org.name}' → id {org.row_index}")
        return org

    def update_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise AppError("update_organization requires row_index")
        with get_session() as s:
            row = s.get(OrganizationRow, org.row_index)
            if row is None:
                raise AppError(f"Organization id={org.row_index} not found")
            row.name = org.name
            row.abbreviation = org.abbreviation
            row.alternate_name = org.alternate_name
            row.primary_contact = org.primary_contact
            row.contact_email = org.contact_email
            row.website = org.website
            row.location = org.location
            row.description = org.description
            row.image_url = org.image_url
            self._log(s, "organization", org.row_index, "update", org.name)
        cache.invalidate("organizations")
        logger.info(f"Updated org '{org.name}' id={org.row_index}")

    def delete_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise AppError("delete_organization requires row_index")
        with get_session() as s:
            row = s.get(OrganizationRow, org.row_index)
            if row:
                s.delete(row)
                self._log(s, "organization", org.row_index, "delete", org.name)
        cache.invalidate("organizations")
        logger.info(f"Deleted org '{org.name}' id={org.row_index}")

    def populate_organizations(self, orgs: list[Organization], append_only: bool = False) -> int:
        with get_session() as s:
            if not append_only:
                s.execute(text("DELETE FROM organizations"))
                to_write = list(orgs)
            else:
                existing = {
                    r.name.lower()
                    for r in s.execute(select(OrganizationRow)).scalars()
                }
                to_write = [o for o in orgs if o.name.lower() not in existing]

            for o in to_write:
                row = OrganizationRow.from_dataclass(o)
                row.id = None
                s.add(row)
            self._log(s, "organization", None, "populate",
                      detail=f"{len(to_write)} orgs (append_only={append_only})")
        cache.invalidate("organizations")
        logger.info(f"Populated {len(to_write)} orgs (append_only={append_only})")
        return len(to_write)

    # ── Sheets sync helpers ───────────────────────────────────────────────────

    def upsert_from_sheets(
        self,
        contacts: list[Contact],
        events: list[Event],
        presenters: list[Presenter],
        orgs: list[Organization],
    ) -> dict:
        """Bulk upsert records fetched from Google Sheets into Postgres.

        Uses sheet row_index as the primary key.  Existing rows are updated;
        new rows (new row_index) are inserted.  This is called by the
        pull-sheet sync when the user accepts incoming changes.

        Returns counts: {contacts, events, presenters, orgs}
        """
        counts = {}

        with get_session() as s:
            # --- contacts ---
            for c in contacts:
                if c.row_index is None:
                    continue
                row = s.get(ContactRow, c.row_index)
                if row is None:
                    row = ContactRow.from_dataclass(c)
                    s.add(row)
                else:
                    row.name = c.name; row.organization = c.organization
                    row.title = c.title; row.email = c.email
                    row.office_phone = c.office_phone; row.work_cell = c.work_cell
                    row.website = c.website; row.last_updated = c.last_updated
                    row.notes = c.notes; row.receive_newsletter = c.receive_newsletter
                    row.image_url = c.image_url
            counts["contacts"] = len(contacts)

            # --- events ---
            for e in events:
                if e.row_index is None:
                    continue
                row = s.get(EventRow, e.row_index)
                if row is None:
                    row = EventRow.from_dataclass(e)
                    s.add(row)
                else:
                    row.title = e.title; row.organization = e.organization
                    row.days = e.days; row.start_time = e.start_time
                    row.end_time = e.end_time; row.location = e.location
                    row.virtual_location = e.virtual_location
                    row.contact_email = e.contact_email
                    row.description = e.description; row.icon_url = e.icon_url
            counts["events"] = len(events)

            # --- presenters ---
            for p in presenters:
                if p.row_index is None:
                    continue
                row = s.get(PresenterRow, p.row_index)
                if row is None:
                    row = PresenterRow.from_dataclass(p)
                    s.add(row)
                else:
                    row.name = p.name; row.organization = p.organization
                    row.slides_link = p.slides_link
                    row.presentation_month = p.presentation_month
                    row.description = p.description
                    row.presentation_year = p.presentation_year
            counts["presenters"] = len(presenters)

            # --- orgs ---
            for o in orgs:
                if not o.row_index:
                    continue
                row = s.get(OrganizationRow, o.row_index)
                if row is None:
                    row = OrganizationRow.from_dataclass(o)
                    s.add(row)
                else:
                    row.name = o.name; row.abbreviation = o.abbreviation
                    row.alternate_name = o.alternate_name
                    row.primary_contact = o.primary_contact
                    row.contact_email = o.contact_email; row.website = o.website
                    row.location = o.location; row.description = o.description
                    row.image_url = o.image_url
            counts["orgs"] = len(orgs)

            self._log(s, "sync", None, "upsert_from_sheets",
                      detail=json.dumps(counts))

        cache.invalidate("contacts")
        cache.invalidate("events")
        cache.invalidate("presenters")
        cache.invalidate("organizations")
        logger.info(f"Upserted from sheets: {counts}")
        return counts
