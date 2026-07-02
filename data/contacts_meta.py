"""Local supplement store for per-contact metadata NOT stored in Google Sheets.

Keyed by str(row_index).

Schema (each record):
  tags  list[str]  — free-form tag strings (e.g. "march", "board")
"""
import json
from pathlib import Path

from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

_STORE_FILE = Path(__file__).parent / "contacts_meta.json"
_CLOUD_KEY  = "contacts_meta"


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
    return _load().get(str(row_index), {})


def set_meta(row_index: int, updates: dict) -> dict:
    data = _load()
    key = str(row_index)
    record = data.get(key, {})
    if "tags" in updates:
        record["tags"] = [str(t).strip() for t in updates["tags"] if str(t).strip()]
    data[key] = record
    _save(data)
    return record


def delete_meta(row_index: int) -> None:
    data = _load()
    data.pop(str(row_index), None)
    _save(data)


def get_all_meta() -> dict:
    return _load()
