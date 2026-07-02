"""SQLAlchemy ORM models for Hormiga's core entities.

Row → Dataclass mapping:
    ContactRow      ↔  schemas.contact.Contact       (row_index = id)
    EventRow        ↔  schemas.event.Event            (row_index = id)
    PresenterRow    ↔  schemas.presenter.Presenter    (row_index = id)
    OrganizationRow ↔  schemas.organization.Organization (row_index = id)

The `id` column in every table maps to `row_index` in the dataclasses.
During the initial import, sheet row numbers are used as explicit IDs so
that all existing contacts_meta / events_meta associations stay valid.
New records created through the app get auto-incremented IDs.

ActivityLog records every write operation for audit purposes.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Integer, String, Text, func
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ── Contacts ──────────────────────────────────────────────────────────────────

class ContactRow(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    organization: Mapped[str] = mapped_column(String, default="")
    title: Mapped[str] = mapped_column(String, default="")
    email: Mapped[str] = mapped_column(String, default="")
    office_phone: Mapped[str] = mapped_column(String, default="")
    work_cell: Mapped[str] = mapped_column(String, default="")
    website: Mapped[str] = mapped_column(String, default="")
    last_updated: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    internal_notes: Mapped[str] = mapped_column(Text, default="")
    receive_newsletter: Mapped[bool] = mapped_column(Boolean, default=True)
    image_url: Mapped[str] = mapped_column(String, default="")

    def to_dataclass(self):
        from schemas.contact import Contact
        return Contact(
            name=self.name or "",
            organization=self.organization or "",
            title=self.title or "",
            email=self.email or "",
            office_phone=self.office_phone or "",
            work_cell=self.work_cell or "",
            website=self.website or "",
            last_updated=self.last_updated or "",
            notes=self.notes or "",
            internal_notes=self.internal_notes or "",
            receive_newsletter=bool(self.receive_newsletter),
            image_url=self.image_url or "",
            row_index=self.id,
        )

    @classmethod
    def from_dataclass(cls, c) -> "ContactRow":
        return cls(
            id=c.row_index,
            name=c.name,
            organization=c.organization,
            title=c.title,
            email=c.email,
            office_phone=c.office_phone,
            work_cell=c.work_cell,
            website=c.website,
            last_updated=c.last_updated,
            notes=c.notes,
            internal_notes=c.internal_notes,
            receive_newsletter=c.receive_newsletter,
            image_url=c.image_url,
        )


# ── Events ────────────────────────────────────────────────────────────────────

class EventRow(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String, nullable=False, default="")
    organization: Mapped[str] = mapped_column(String, default="")
    days: Mapped[str] = mapped_column(String, default="")
    start_time: Mapped[str] = mapped_column(String, default="")
    end_time: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    virtual_location: Mapped[str] = mapped_column(String, default="")
    contact_email: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    icon_url: Mapped[str] = mapped_column(String, default="")
    color: Mapped[str] = mapped_column(String, default="#2563eb")

    def to_dataclass(self):
        from schemas.event import Event
        return Event(
            title=self.title or "",
            organization=self.organization or "",
            days=self.days or "",
            start_time=self.start_time or "",
            end_time=self.end_time or "",
            location=self.location or "",
            virtual_location=self.virtual_location or "",
            contact_email=self.contact_email or "",
            description=self.description or "",
            icon_url=self.icon_url or "",
            color=self.color or "#2563eb",
            row_index=self.id,
        )

    @classmethod
    def from_dataclass(cls, e) -> "EventRow":
        return cls(
            id=e.row_index,
            title=e.title,
            organization=e.organization,
            days=e.days,
            start_time=e.start_time,
            end_time=e.end_time,
            location=e.location,
            virtual_location=e.virtual_location,
            contact_email=e.contact_email,
            description=e.description,
            icon_url=e.icon_url,
            color=e.color,
        )


# ── Presenters ────────────────────────────────────────────────────────────────

class PresenterRow(Base):
    __tablename__ = "presenters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    organization: Mapped[str] = mapped_column(String, default="")
    slides_link: Mapped[str] = mapped_column(String, default="")
    presentation_month: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    presentation_year: Mapped[str] = mapped_column(String, default="")

    def to_dataclass(self):
        from schemas.presenter import Presenter
        return Presenter(
            name=self.name or "",
            organization=self.organization or "",
            slides_link=self.slides_link or "",
            presentation_month=self.presentation_month or "",
            description=self.description or "",
            presentation_year=self.presentation_year or "",
            row_index=self.id,
        )

    @classmethod
    def from_dataclass(cls, p) -> "PresenterRow":
        return cls(
            id=p.row_index,
            name=p.name,
            organization=p.organization,
            slides_link=p.slides_link,
            presentation_month=p.presentation_month,
            description=p.description,
            presentation_year=p.presentation_year,
        )


# ── Organizations ─────────────────────────────────────────────────────────────

class OrganizationRow(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="")
    abbreviation: Mapped[str] = mapped_column(String, default="")
    alternate_name: Mapped[str] = mapped_column(String, default="")
    primary_contact: Mapped[str] = mapped_column(String, default="")
    contact_email: Mapped[str] = mapped_column(String, default="")
    website: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String, default="")

    def to_dataclass(self):
        from schemas.organization import Organization
        return Organization(
            name=self.name or "",
            abbreviation=self.abbreviation or "",
            alternate_name=self.alternate_name or "",
            primary_contact=self.primary_contact or "",
            contact_email=self.contact_email or "",
            website=self.website or "",
            location=self.location or "",
            description=self.description or "",
            image_url=self.image_url or "",
            row_index=self.id,
        )

    @classmethod
    def from_dataclass(cls, o) -> "OrganizationRow":
        return cls(
            id=o.row_index or None,
            name=o.name,
            abbreviation=o.abbreviation,
            alternate_name=o.alternate_name,
            primary_contact=o.primary_contact,
            contact_email=o.contact_email,
            website=o.website,
            location=o.location,
            description=o.description,
            image_url=o.image_url,
        )


# ── Activity Log ──────────────────────────────────────────────────────────────

class ActivityLog(Base):
    """Append-only audit trail for all write operations."""
    __tablename__ = "activity_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    entity_type: Mapped[str] = mapped_column(String, nullable=False)   # contact/event/presenter/org
    entity_id: Mapped[int] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)        # create/update/delete
    entity_name: Mapped[str] = mapped_column(String, default="")      # display name snapshot
    detail: Mapped[str] = mapped_column(Text, default="")             # JSON or free-text summary


# ── JSON Store ─────────────────────────────────────────────────────────────────

class JsonStore(Base):
    """Key-value store for JSON blobs — backs images, jobs, tags, graph, and
    per-entity metadata stores.  Each "file" (e.g. images.json) becomes one
    row keyed by its store name.  Switching DB providers only requires
    updating engine.py — nothing else changes.
    """
    __tablename__ = "json_store"

    key:        Mapped[str]      = mapped_column(String, primary_key=True)
    data:       Mapped[dict]     = mapped_column(JSONB,  nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
