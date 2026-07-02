"""Simple synchronous pub/sub event bus (Python side).

Usage:
    from core.event_bus import bus

    bus.on("contacts:updated", lambda data: print(data))
    bus.emit("contacts:updated", {"count": 5})
    bus.off("contacts:updated", my_handler)
"""
from collections import defaultdict
from typing import Any, Callable

from core.logger import get_logger

logger = get_logger("event_bus")


class EventBus:
    def __init__(self) -> None:
        self._listeners: dict[str, list[Callable]] = defaultdict(list)

    def on(self, event: str, callback: Callable) -> None:
        self._listeners[event].append(callback)
        logger.debug(f"Subscribed '{callback.__name__}' to '{event}'")

    def off(self, event: str, callback: Callable) -> None:
        self._listeners[event] = [
            cb for cb in self._listeners[event] if cb is not callback
        ]

    def emit(self, event: str, data: Any = None) -> None:
        logger.debug(f"Emit '{event}' data={data!r}")
        for cb in list(self._listeners.get(event, [])):
            try:
                cb(data)
            except Exception as exc:
                logger.error(f"Listener '{cb.__name__}' raised on '{event}': {exc}")

    def clear(self, event: str | None = None) -> None:
        if event:
            self._listeners.pop(event, None)
        else:
            self._listeners.clear()


# Application-wide singleton
bus = EventBus()
