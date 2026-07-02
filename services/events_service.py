"""Business logic for events, wired to the command/undo system."""
from core.command import Command, history
from core.event_bus import bus
from core.logger import get_logger
from data.repository import BaseRepository
from schemas.event import Event

logger = get_logger("events_service")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

class _AddEventCommand(Command):
    def __init__(self, repo: BaseRepository, event: Event) -> None:
        self._repo = repo
        self._event = event

    @property
    def description(self) -> str:
        return f"Add event: {self._event.title}"

    def execute(self) -> None:
        self._repo.add_event(self._event)
        bus.emit("events:changed")

    def undo(self) -> None:
        logger.warning("Undo add_event is not implemented for Sheets backend.")
        bus.emit("events:changed")


class _UpdateEventCommand(Command):
    def __init__(self, repo: BaseRepository, old: Event, new: Event) -> None:
        self._repo = repo
        self._old = old
        self._new = new

    @property
    def description(self) -> str:
        return f"Update event: {self._new.title}"

    def execute(self) -> None:
        self._repo.update_event(self._new)
        bus.emit("events:changed")

    def undo(self) -> None:
        self._repo.update_event(self._old)
        bus.emit("events:changed")


class _DeleteEventCommand(Command):
    def __init__(self, repo: BaseRepository, event: Event) -> None:
        self._repo = repo
        self._event = event

    @property
    def description(self) -> str:
        return f"Delete event: {self._event.title}"

    def execute(self) -> None:
        self._repo.delete_event(self._event)
        bus.emit("events:changed")

    def undo(self) -> None:
        # Re-adding after a delete would be an append (losing original row position).
        # For now, log and inform caller.
        logger.warning("Undo delete_event is not implemented for Sheets backend.")
        bus.emit("events:changed")


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------

def get_events(repo: BaseRepository) -> list[Event]:
    return repo.get_events()


def add_event(repo: BaseRepository, data: dict) -> Event:
    event = Event(
        title=data.get("title", ""),
        organization=data.get("organization", ""),
        days=data.get("days", ""),
        start_time=data.get("start_time", ""),
        end_time=data.get("end_time", ""),
        location=data.get("location", ""),
        virtual_location=data.get("virtual_location", ""),
        contact_email=data.get("contact_email", ""),
        description=data.get("description", ""),
        icon_url=data.get("icon_url", ""),
        color=data.get("color", "#2563eb"),
    )
    history.execute(_AddEventCommand(repo, event))
    return event


def update_event(repo: BaseRepository, old: Event, data: dict) -> Event:
    new = Event(
        title=data.get("title", old.title),
        organization=data.get("organization", old.organization),
        days=data.get("days", old.days),
        start_time=data.get("start_time", old.start_time),
        end_time=data.get("end_time", old.end_time),
        location=data.get("location", old.location),
        virtual_location=data.get("virtual_location", old.virtual_location),
        contact_email=data.get("contact_email", old.contact_email),
        description=data.get("description", old.description),
        icon_url=data.get("icon_url", old.icon_url),
        color=data.get("color", old.color),
        row_index=old.row_index,
    )
    history.execute(_UpdateEventCommand(repo, old, new))
    return new


def delete_event(repo: BaseRepository, event: Event) -> None:
    history.execute(_DeleteEventCommand(repo, event))
