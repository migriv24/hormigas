"""Cloud-backed key-value store for JSON blobs — Supabase REST API edition.

Replaces local JSON files (images.json, jobs.json, tags.json, etc.) with rows
in the `json_store` Supabase table, accessed via the REST API (no direct
PostgreSQL connection required — works over HTTPS on any network).

Usage in any store module:

    from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

    def _load() -> dict:
        if is_cloud_available():
            return cloud_load('images') or {"_schema_version": 1, "images": []}
        # ... fall back to local file ...

    def _save(data: dict) -> None:
        if is_cloud_available():
            cloud_save('images', data)
            return
        # ... write local file ...

Switching cloud providers only requires updating core/settings.py with the
new provider's URL and key — all store modules are unaffected.
"""

import json
import logging
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

# Path to the local data directory (sibling of db/)
_DATA_DIR = Path(__file__).parent.parent

# Known store keys and their local file names (used for one-time migration)
_LOCAL_FILES: dict[str, str] = {
    "images":         "images.json",
    "jobs":           "jobs.json",
    "tags":           "tags.json",
    "graph":          "graph.json",
    "contacts_meta":  "contacts_meta.json",
    "events_meta":    "events_meta.json",
    "presenter_meta": "presenter_meta.json",
}

_available: bool | None = None  # cached after first check


def _supabase_url() -> str:
    from core.settings import get_supabase_url
    return (get_supabase_url() or "").rstrip("/")


def _headers() -> dict:
    from core.settings import get_supabase_anon_key
    key = get_supabase_anon_key() or ""
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def is_cloud_available() -> bool:
    """Return True when Supabase URL + anon key are configured. Cached."""
    global _available
    if _available is None:
        try:
            from core.settings import is_supabase_configured
            _available = is_supabase_configured()
        except Exception:
            _available = False
    return _available


def cloud_load(key: str) -> Any | None:
    """Return the stored value for *key*, or None if not found / on error."""
    try:
        resp = requests.get(
            f"{_supabase_url()}/rest/v1/json_store",
            params={"key": f"eq.{key}", "select": "data"},
            headers=_headers(),
            timeout=15,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["data"] if rows else None
    except Exception as exc:
        logger.warning("cloud_load(%r) failed: %s", key, exc)
        return None


def cloud_save(key: str, data: Any) -> None:
    """Upsert *data* (JSON-serialisable) under *key*."""
    try:
        resp = requests.post(
            f"{_supabase_url()}/rest/v1/json_store",
            json={"key": key, "data": data},
            headers={
                **_headers(),
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.error("cloud_save(%r) failed: %s", key, exc)
        raise


def migrate_local_to_cloud() -> None:
    """One-time migration: upload local JSON files to cloud if not already there.

    Runs on startup when cloud is available.  Each store key is only uploaded
    if it doesn't already exist in json_store, so this is safe to call on every
    boot — it's a no-op once migration is complete.
    """
    if not is_cloud_available():
        return
    for key, filename in _LOCAL_FILES.items():
        try:
            existing = cloud_load(key)
            if existing is not None:
                logger.debug("migrate_local_to_cloud: %r already in cloud, skipping", key)
                continue
            local_path = _DATA_DIR / filename
            if not local_path.exists():
                logger.debug("migrate_local_to_cloud: no local file for %r, skipping", key)
                continue
            file_data = json.loads(local_path.read_text(encoding="utf-8"))
            cloud_save(key, file_data)
            logger.info("migrate_local_to_cloud: uploaded %r from %s", key, filename)
        except Exception as exc:
            logger.warning("migrate_local_to_cloud: failed for %r: %s", key, exc)
