"""Local supplement store for per-event metadata NOT stored in Google Sheets.

Keyed by str(row_index). Because row_index can shift when sheet rows are added
or deleted, treat this as a best-effort cache — callers are responsible for
reconciling keys if the sheet is restructured.

Schema (each record, keyed by str(row_index)):
  tags     list[str]  — free-form tag strings
  icon_url str        — event icon URL (overrides sheet value when set)
"""
import json
from pathlib import Path

from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

_STORE_FILE = Path(__file__).parent / "events_meta.json"
_CLOUD_KEY  = "events_meta"


def _load() -> dict:
    if is_cloud_available():
        return cloud_load(_CLOUD_KEY) or {}
    if not _STORE_FILE.exists():
        return {}
    try:
        return json.loads(_STORE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(data: dict) -> None:
    if is_cloud_available():
        cloud_save(_CLOUD_KEY, data)
        return
    _STORE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_meta(row_index: int) -> dict:
    """Return metadata for a single event, or an empty dict if none stored."""
    return _load().get(str(row_index), {})


def set_meta(row_index: int, updates: dict) -> dict:
    """Merge *updates* into stored metadata for the event. Returns updated record."""
    data = _load()
    key = str(row_index)
    record = data.get(key, {})
    if "tags" in updates:
        record["tags"] = [str(t).strip() for t in updates["tags"] if str(t).strip()]
    if "icon_url" in updates:
        record["icon_url"] = str(updates["icon_url"]).strip()
    data[key] = record
    _save(data)
    return record


def delete_meta(row_index: int) -> None:
    """Remove stored metadata for an event (call when event is deleted)."""
    data = _load()
    data.pop(str(row_index), None)
    _save(data)


def get_all_meta() -> dict:
    """Return the full metadata dict {str(row_index): {tags: [...]}}."""
    return _load()
