"""Supabase REST API implementation of BaseRepository.

Replaces PostgresRepository when supabase.url + supabase.anon_key are
configured.  All reads and writes go over HTTPS — no direct PostgreSQL
connection required.  Works on any network without IPv6 or DNS-pooler issues.

Table → dataclass mapping mirrors PostgresRepository exactly so all service
and route code is unaffected by the swap.
"""
import json
import logging

import requests

from core.exceptions import AppError
from data.cache import cache
from data.repository import BaseRepository
from schemas.contact import Contact
from schemas.event import Event
from schemas.organization import Organization
from schemas.presenter import Presenter

logger = logging.getLogger("supabase_repo")


class SupabaseRestRepository(BaseRepository):

    def __init__(self, url: str, anon_key: str) -> None:
        self._url = url.rstrip("/")
        self._key = anon_key

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def _get(self, table: str, params: dict | None = None) -> list[dict]:
        resp = requests.get(
            f"{self._url}/rest/v1/{table}",
            params=params or {},
            headers=self._headers(),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def _post(self, table: str, payload: dict, prefer: str = "return=representation") -> dict | None:
        resp = requests.post(
            f"{self._url}/rest/v1/{table}",
            json=payload,
            headers=self._headers({"Prefer": prefer}),
            timeout=15,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None

    def _patch(self, table: str, filter_param: str, payload: dict) -> None:
        resp = requests.patch(
            f"{self._url}/rest/v1/{table}",
            params={filter_param.split("=")[0]: filter_param.split("=")[1]},
            json=payload,
            headers=self._headers({"Prefer": "return=minimal"}),
            timeout=15,
        )
        resp.raise_for_status()

    def _delete(self, table: str, filter_param: str) -> None:
        k, v = filter_param.split("=", 1)
        resp = requests.delete(
            f"{self._url}/rest/v1/{table}",
            params={k: v},
            headers=self._headers(),
            timeout=15,
        )
        resp.raise_for_status()

    def _upsert(self, table: str, payload: dict | list) -> list[dict]:
        resp = requests.post(
            f"{self._url}/rest/v1/{table}",
            json=payload,
            headers=self._headers({"Prefer": "resolution=merge-duplicates,return=representation"}),
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def _log(self, entity_type: str, entity_id: int | None,
             action: str, name: str = "", detail: str = "") -> None:
        try:
            self._post("activity_log", {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "action": action,
                "entity_name": name,
                "detail": detail,
            }, prefer="return=minimal")
        except Exception as exc:
            logger.warning("activity_log write failed: %s", exc)

    # ── Contacts ──────────────────────────────────────────────────────────────

    def get_contacts(self) -> list[Contact]:
        hit = cache.get("contacts")
        if hit is not None:
            return hit
        rows = self._get("contacts", {"order": "id", "select": "*"})
        result = [_row_to_contact(r) for r in rows if r.get("name")]
        cache.set("contacts", result)
        logger.info("Loaded %d contacts via REST", len(result))
        return result

    def add_contact(self, contact: Contact) -> Contact:
        row = self._post("contacts", _contact_to_row(contact))
        if row:
            contact.row_index = row["id"]
        self._log("contact", contact.row_index, "create", contact.name)
        cache.invalidate("contacts")
        return contact

    def update_contact(self, contact: Contact) -> None:
        if contact.row_index is None:
            raise AppError("update_contact requires row_index")
        resp = requests.patch(
            f"{self._url}/rest/v1/contacts",
            params={"id": f"eq.{contact.row_index}"},
            json=_contact_to_row(contact),
            headers=self._headers({"Prefer": "return=minimal"}),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("contact", contact.row_index, "update", contact.name)
        cache.invalidate("contacts")

    # ── Events ────────────────────────────────────────────────────────────────

    def get_events(self) -> list[Event]:
        hit = cache.get("events")
        if hit is not None:
            return hit
        rows = self._get("events", {"order": "id", "select": "*"})
        result = [_row_to_event(r) for r in rows]
        cache.set("events", result)
        logger.info("Loaded %d events via REST", len(result))
        return result

    def add_event(self, event: Event) -> Event:
        row = self._post("events", _event_to_row(event))
        if row:
            event.row_index = row["id"]
        self._log("event", event.row_index, "create", event.title)
        cache.invalidate("events")
        return event

    def update_event(self, event: Event) -> None:
        if event.row_index is None:
            raise AppError("update_event requires row_index")
        resp = requests.patch(
            f"{self._url}/rest/v1/events",
            params={"id": f"eq.{event.row_index}"},
            json=_event_to_row(event),
            headers=self._headers({"Prefer": "return=minimal"}),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("event", event.row_index, "update", event.title)
        cache.invalidate("events")

    def delete_event(self, event: Event) -> None:
        if event.row_index is None:
            raise AppError("delete_event requires row_index")
        resp = requests.delete(
            f"{self._url}/rest/v1/events",
            params={"id": f"eq.{event.row_index}"},
            headers=self._headers(),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("event", event.row_index, "delete", event.title)
        cache.invalidate("events")

    # ── Presenters ────────────────────────────────────────────────────────────

    def get_presenters(self) -> list[Presenter]:
        hit = cache.get("presenters")
        if hit is not None:
            return hit
        rows = self._get("presenters", {"order": "id", "select": "*"})
        result = [_row_to_presenter(r) for r in rows]
        cache.set("presenters", result)
        logger.info("Loaded %d presenters via REST", len(result))
        return result

    def add_presenter(self, presenter: Presenter) -> Presenter:
        row = self._post("presenters", _presenter_to_row(presenter))
        if row:
            presenter.row_index = row["id"]
        self._log("presenter", presenter.row_index, "create", presenter.name)
        cache.invalidate("presenters")
        return presenter

    def update_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise AppError("update_presenter requires row_index")
        resp = requests.patch(
            f"{self._url}/rest/v1/presenters",
            params={"id": f"eq.{presenter.row_index}"},
            json=_presenter_to_row(presenter),
            headers=self._headers({"Prefer": "return=minimal"}),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("presenter", presenter.row_index, "update", presenter.name)
        cache.invalidate("presenters")

    def delete_presenter(self, presenter: Presenter) -> None:
        if presenter.row_index is None:
            raise AppError("delete_presenter requires row_index")
        resp = requests.delete(
            f"{self._url}/rest/v1/presenters",
            params={"id": f"eq.{presenter.row_index}"},
            headers=self._headers(),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("presenter", presenter.row_index, "delete", presenter.name)
        cache.invalidate("presenters")

    # ── Organizations ─────────────────────────────────────────────────────────

    def get_organizations(self) -> list[Organization]:
        hit = cache.get("organizations")
        if hit is not None:
            return hit
        rows = self._get("organizations", {"order": "name", "select": "*"})
        result = [_row_to_org(r) for r in rows]
        cache.set("organizations", result)
        logger.info("Loaded %d organizations via REST", len(result))
        return result

    def add_organization(self, org: Organization) -> Organization:
        row = self._post("organizations", _org_to_row(org))
        if row:
            org.row_index = row["id"]
        self._log("organization", org.row_index, "create", org.name)
        cache.invalidate("organizations")
        return org

    def update_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise AppError("update_organization requires row_index")
        resp = requests.patch(
            f"{self._url}/rest/v1/organizations",
            params={"id": f"eq.{org.row_index}"},
            json=_org_to_row(org),
            headers=self._headers({"Prefer": "return=minimal"}),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("organization", org.row_index, "update", org.name)
        cache.invalidate("organizations")

    def delete_organization(self, org: Organization) -> None:
        if not org.row_index:
            raise AppError("delete_organization requires row_index")
        resp = requests.delete(
            f"{self._url}/rest/v1/organizations",
            params={"id": f"eq.{org.row_index}"},
            headers=self._headers(),
            timeout=15,
        )
        resp.raise_for_status()
        self._log("organization", org.row_index, "delete", org.name)
        cache.invalidate("organizations")

    def populate_organizations(self, orgs: list[Organization], append_only: bool = False) -> int:
        if not append_only:
            # Delete all then re-insert
            requests.delete(
                f"{self._url}/rest/v1/organizations",
                params={"id": "neq.0"},  # matches all rows
                headers=self._headers(),
                timeout=15,
            ).raise_for_status()
            to_write = list(orgs)
        else:
            existing_names = {r["name"].lower() for r in self._get("organizations", {"select": "name"})}
            to_write = [o for o in orgs if o.name.lower() not in existing_names]

        if to_write:
            self._upsert("organizations", [_org_to_row(o) for o in to_write])
        self._log("organization", None, "populate",
                  detail=json.dumps({"count": len(to_write), "append_only": append_only}))
        cache.invalidate("organizations")
        logger.info("Populated %d orgs (append_only=%s)", len(to_write), append_only)
        return len(to_write)

    # ── Sheets sync ───────────────────────────────────────────────────────────

    def upsert_from_sheets(
        self,
        contacts: list[Contact],
        events: list[Event],
        presenters: list[Presenter],
        orgs: list[Organization],
    ) -> dict:
        counts = {}

        if contacts:
            self._upsert("contacts", [_contact_to_row(c) for c in contacts if c.row_index])
            counts["contacts"] = len(contacts)

        if events:
            self._upsert("events", [_event_to_row(e) for e in events if e.row_index])
            counts["events"] = len(events)

        if presenters:
            self._upsert("presenters", [_presenter_to_row(p) for p in presenters if p.row_index])
            counts["presenters"] = len(presenters)

        if orgs:
            self._upsert("organizations", [_org_to_row(o) for o in orgs if o.row_index])
            counts["orgs"] = len(orgs)

        self._log("sync", None, "upsert_from_sheets", detail=json.dumps(counts))

        cache.invalidate("contacts")
        cache.invalidate("events")
        cache.invalidate("presenters")
        cache.invalidate("organizations")
        logger.info("Upserted from sheets via REST: %s", counts)
        return counts


# ── Row ↔ dataclass converters ────────────────────────────────────────────────

def _row_to_contact(r: dict) -> Contact:
    from schemas.contact import Contact
    return Contact(
        name=r.get("name", ""),
        organization=r.get("organization", ""),
        title=r.get("title", ""),
        email=r.get("email", ""),
        office_phone=r.get("office_phone", ""),
        work_cell=r.get("work_cell", ""),
        website=r.get("website", ""),
        last_updated=r.get("last_updated", ""),
        notes=r.get("notes", ""),
        receive_newsletter=bool(r.get("receive_newsletter", True)),
        image_url=r.get("image_url", ""),
        row_index=r.get("id"),
    )


def _contact_to_row(c: Contact) -> dict:
    row = {
        "name": c.name, "organization": c.organization, "title": c.title,
        "email": c.email, "office_phone": c.office_phone, "work_cell": c.work_cell,
        "website": c.website, "last_updated": c.last_updated, "notes": c.notes,
        "receive_newsletter": c.receive_newsletter, "image_url": c.image_url,
    }
    if c.row_index is not None:
        row["id"] = c.row_index
    return row


def _row_to_event(r: dict) -> Event:
    from schemas.event import Event
    return Event(
        title=r.get("title", ""),
        organization=r.get("organization", ""),
        days=r.get("days", ""),
        start_time=r.get("start_time", ""),
        end_time=r.get("end_time", ""),
        location=r.get("location", ""),
        virtual_location=r.get("virtual_location", ""),
        contact_email=r.get("contact_email", ""),
        description=r.get("description", ""),
        icon_url=r.get("icon_url", ""),
        color=r.get("color", "#2563eb"),
        row_index=r.get("id"),
    )


def _event_to_row(e: Event) -> dict:
    row = {
        "title": e.title, "organization": e.organization, "days": e.days,
        "start_time": e.start_time, "end_time": e.end_time, "location": e.location,
        "virtual_location": e.virtual_location, "contact_email": e.contact_email,
        "description": e.description, "icon_url": e.icon_url, "color": e.color,
    }
    if e.row_index is not None:
        row["id"] = e.row_index
    return row


def _row_to_presenter(r: dict) -> Presenter:
    from schemas.presenter import Presenter
    return Presenter(
        name=r.get("name", ""),
        organization=r.get("organization", ""),
        slides_link=r.get("slides_link", ""),
        presentation_month=r.get("presentation_month", ""),
        description=r.get("description", ""),
        presentation_year=r.get("presentation_year", ""),
        row_index=r.get("id"),
    )


def _presenter_to_row(p: Presenter) -> dict:
    row = {
        "name": p.name, "organization": p.organization, "slides_link": p.slides_link,
        "presentation_month": p.presentation_month, "description": p.description,
        "presentation_year": p.presentation_year,
    }
    if p.row_index is not None:
        row["id"] = p.row_index
    return row


def _row_to_org(r: dict) -> Organization:
    from schemas.organization import Organization
    return Organization(
        name=r.get("name", ""),
        abbreviation=r.get("abbreviation", ""),
        alternate_name=r.get("alternate_name", ""),
        primary_contact=r.get("primary_contact", ""),
        contact_email=r.get("contact_email", ""),
        website=r.get("website", ""),
        location=r.get("location", ""),
        description=r.get("description", ""),
        image_url=r.get("image_url", ""),
        row_index=r.get("id"),
    )


def _org_to_row(o: Organization) -> dict:
    row = {
        "name": o.name, "abbreviation": o.abbreviation, "alternate_name": o.alternate_name,
        "primary_contact": o.primary_contact, "contact_email": o.contact_email,
        "website": o.website, "location": o.location, "description": o.description,
        "image_url": o.image_url,
    }
    if o.row_index is not None:
        row["id"] = o.row_index
    return row
