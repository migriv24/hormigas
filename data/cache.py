"""In-memory cache with TTL and dirty tracking.

Keys are arbitrary strings (e.g. "contacts", "events").
Values are stored alongside an expiry timestamp.
"""
import time
from typing import Any, Optional

from core.logger import get_logger
from core.settings import get_settings

logger = get_logger("cache")


class Cache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def _ttl(self) -> int:
        try:
            return int(get_settings().get("cache_ttl_seconds", 300))
        except Exception:
            return 300

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        expires_at = time.monotonic() + (ttl if ttl is not None else self._ttl())
        self._store[key] = (value, expires_at)
        logger.debug(f"Cache set: '{key}' (ttl={ttl or self._ttl()}s)")

    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            logger.debug(f"Cache expired: '{key}'")
            return None
        return value

    def invalidate(self, key: str) -> None:
        if key in self._store:
            del self._store[key]
            logger.debug(f"Cache invalidated: '{key}'")

    def clear(self) -> None:
        self._store.clear()
        logger.info("Cache cleared")

    def keys(self) -> list[str]:
        return list(self._store.keys())


# Application-wide singleton
cache = Cache()
