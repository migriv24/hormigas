"""Business logic for contacts, wired to the command/undo system."""
from core.command import Command, history
from core.event_bus import bus
from core.logger import get_logger
from data.repository import BaseRepository
from schemas.contact import Contact

logger = get_logger("contacts_service")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

class _AddContactCommand(Command):
    def __init__(self, repo: BaseRepository, contact: Contact) -> None:
        self._repo = repo
        self._contact = contact

    @property
    def description(self) -> str:
        return f"Add contact: {self._contact.name}"

    def execute(self) -> None:
        self._repo.add_contact(self._contact)
        bus.emit("contacts:changed")

    def undo(self) -> None:
        # Undo an append: we'd need to delete the last row — tricky with Sheets.
        # For safety, log a warning rather than silently doing nothing.
        logger.warning(f"Undo add_contact is not implemented for Sheets backend.")
        bus.emit("contacts:changed")


class _UpdateContactCommand(Command):
    def __init__(self, repo: BaseRepository, old: Contact, new: Contact) -> None:
        self._repo = repo
        self._old = old
        self._new = new

    @property
    def description(self) -> str:
        return f"Update contact: {self._new.name}"

    def execute(self) -> None:
        self._repo.update_contact(self._new)
        bus.emit("contacts:changed")

    def undo(self) -> None:
        self._repo.update_contact(self._old)
        bus.emit("contacts:changed")


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------

def get_contacts(repo: BaseRepository) -> list[Contact]:
    return repo.get_contacts()


def add_contact(repo: BaseRepository, data: dict) -> Contact:
    contact = Contact(
        name=data.get("name", ""),
        organization=data.get("organization", ""),
        title=data.get("title", ""),
        email=data.get("email", ""),
        office_phone=data.get("office_phone", ""),
        work_cell=data.get("work_cell", ""),
        website=data.get("website", ""),
        last_updated=data.get("last_updated", ""),
        notes=data.get("notes", ""),
        receive_newsletter=data.get("receive_newsletter", True),
        image_url=data.get("image_url", ""),
    )
    history.execute(_AddContactCommand(repo, contact))
    return contact


def update_contact(repo: BaseRepository, old: Contact, data: dict) -> Contact:
    new = Contact(
        name=data.get("name", old.name),
        organization=data.get("organization", old.organization),
        title=data.get("title", old.title),
        email=data.get("email", old.email),
        office_phone=data.get("office_phone", old.office_phone),
        work_cell=data.get("work_cell", old.work_cell),
        website=data.get("website", old.website),
        last_updated=data.get("last_updated", old.last_updated),
        notes=data.get("notes", old.notes),
        internal_notes=data.get("internal_notes", old.internal_notes),
        receive_newsletter=data.get("receive_newsletter", old.receive_newsletter),
        image_url=data.get("image_url", old.image_url),
        row_index=old.row_index,
    )
    history.execute(_UpdateContactCommand(repo, old, new))
    return new


def search_contacts(contacts: list[Contact], query: str) -> list[Contact]:
    q = query.lower()
    return [
        c for c in contacts
        if q in c.name.lower() or q in c.organization.lower() or q in c.email.lower()
    ]


def filter_by_tags(contacts: list[dict], expr: str) -> list[dict]:
    """Filter a list of contact dicts by a tag expression.

    Syntax (space or comma separated):
      march          → item must have "march" tag (OR with others)
      +march +april  → item must have BOTH tags
      -vip           → item must NOT have "vip"
    """
    tokens = expr.lower().replace(',', ' ').split()
    require, optional, exclude = [], [], []
    for t in tokens:
        if t.startswith('+'):
            require.append(t[1:])
        elif t.startswith('-'):
            exclude.append(t[1:])
        else:
            optional.append(t)

    def _matches(c: dict) -> bool:
        tags = [t.lower() for t in c.get("tags", [])]
        if any(ex in tags for ex in exclude):
            return False
        if require and not all(r in tags for r in require):
            return False
        if optional and not any(o in tags for o in optional):
            return False
        return True

    return [c for c in contacts if _matches(c)]
