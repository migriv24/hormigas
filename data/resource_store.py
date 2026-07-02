"""Local resource metadata store.

Persists uploaded resource files (PDFs, etc.) to data/resources.json.
Actual binary files are stored via the storage layer (services/storage/).

Schema (each record):
  id                  str   — stable 12-char hex UUID
  filename            str   — original uploaded filename
  display_name        str   — human-friendly name
  resource_type       str   — "pdf" | future types
  file_path           str   — path/URI returned by the storage backend
  description         str   — notes
  tags                list  — free-form string tags
  language            str   — "" | "en" | "es"
  pair_id             str?  — UUID shared by EN/ES counterpart records (null if standalone)
  uploaded_at         str   — ISO timestamp
  page_count          int   — number of pages (0 if unknown / not applicable)
  generated_image_id  str?  — image_store ID of generated graphic (null if not yet generated)
  generated_image_url str?  — ImgBB URL of generated graphic (null if not yet generated)
  updated_at          str?  — ISO timestamp of last metadata change
"""
import datetime
import json
import uuid
from pathlib import Path

_STORE_FILE = Path(__file__).parent / "resources.json"
_RESOURCES_DIR = Path(__file__).parent / "resources"

_DEFAULTS = {
    "description":          "",
    "tags":                 [],
    "language":             "",
    "pair_id":              None,
    "page_count":           0,
    "generated_image_id":   None,
    "generated_image_url":  None,
    "updated_at":           None,
}


def _ensure_dir() -> None:
    _RESOURCES_DIR.mkdir(exist_ok=True)


def _normalize(rec: dict) -> dict:
    for k, v in _DEFAULTS.items():
        if k == "tags":
            rec.setdefault(k, [])
            if not isinstance(rec[k], list):
                rec[k] = [str(rec[k])] if rec[k] else []
        else:
            rec.setdefault(k, v)
    return rec


def _load() -> list[dict]:
    if not _STORE_FILE.exists():
        return []
    try:
        raw = json.loads(_STORE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    records = raw.get("resources", raw) if isinstance(raw, dict) else raw
    return [_normalize(r) for r in records]


def _save(records: list[dict]) -> None:
    _STORE_FILE.write_text(
        json.dumps({"resources": records}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_resources() -> list[dict]:
    return _load()


def get_resource(resource_id: str) -> dict | None:
    return next((r for r in _load() if r["id"] == resource_id), None)


def add_resource(
    filename: str,
    display_name: str,
    resource_type: str,
    file_path: str,
    description: str = "",
    tags: list = None,
    page_count: int = 0,
    language: str = "",
) -> dict:
    _ensure_dir()
    records = _load()
    now = datetime.datetime.now().isoformat()
    record = {
        "id":                   uuid.uuid4().hex[:12],
        "filename":             filename,
        "display_name":         display_name,
        "resource_type":        resource_type,
        "file_path":            file_path,
        "description":          description,
        "tags":                 tags if isinstance(tags, list) else [],
        "language":             language if language in ("en", "es") else "",
        "pair_id":              None,
        "uploaded_at":          now,
        "page_count":           page_count,
        "generated_image_id":   None,
        "generated_image_url":  None,
        "updated_at":           None,
    }
    records.insert(0, record)
    _save(records)
    return record


def update_resource(
    resource_id: str,
    display_name: str = None,
    description: str = None,
    tags: list = None,
    language: str = None,
    pair_id: str = None,
    generated_image_id: str = None,
    generated_image_url: str = None,
    _clear_generated: bool = False,
    _clear_pair: bool = False,
) -> dict | None:
    records = _load()
    for rec in records:
        if rec["id"] == resource_id:
            if display_name is not None:
                rec["display_name"] = display_name
            if description is not None:
                rec["description"] = description
            if tags is not None:
                rec["tags"] = [str(t).strip() for t in tags if str(t).strip()]
            if language is not None:
                rec["language"] = language if language in ("en", "es") else ""
            if _clear_pair:
                rec["pair_id"] = None
            elif pair_id is not None:
                rec["pair_id"] = pair_id
            if _clear_generated:
                rec["generated_image_id"] = None
                rec["generated_image_url"] = None
            else:
                if generated_image_id is not None:
                    rec["generated_image_id"] = generated_image_id
                if generated_image_url is not None:
                    rec["generated_image_url"] = generated_image_url
            rec["updated_at"] = datetime.datetime.now().isoformat()
            _save(records)
            return rec
    return None


def pair_resources(id1: str, lang1: str, id2: str, lang2: str) -> tuple[dict, dict] | None:
    """Link two resources as EN/ES counterparts. Returns (rec1, rec2) or None if either not found."""
    records = _load()
    r1 = next((r for r in records if r["id"] == id1), None)
    r2 = next((r for r in records if r["id"] == id2), None)
    if r1 is None or r2 is None:
        return None

    # Break any existing pairs for either resource
    for old_id in (r1.get("pair_id"), r2.get("pair_id")):
        if old_id:
            for r in records:
                if r.get("pair_id") == old_id:
                    r["pair_id"] = None

    pid = uuid.uuid4().hex
    r1["language"] = lang1 if lang1 in ("en", "es") else "en"
    r1["pair_id"]  = pid
    r2["language"] = lang2 if lang2 in ("en", "es") else "es"
    r2["pair_id"]  = pid
    now = datetime.datetime.now().isoformat()
    r1["updated_at"] = r2["updated_at"] = now
    _save(records)
    return (_normalize(r1), _normalize(r2))


def unpair_resources(pair_id: str) -> list[dict]:
    """Clear pair_id from all resources sharing it. Returns updated records."""
    records = _load()
    updated = []
    now = datetime.datetime.now().isoformat()
    for rec in records:
        if rec.get("pair_id") == pair_id:
            rec["pair_id"] = None
            rec["updated_at"] = now
            updated.append(_normalize(rec))
    _save(records)
    return updated


def delete_resource(resource_id: str) -> dict | None:
    """Remove from store and delete the local file. Returns the deleted record or None.

    Note: this deletes the file directly (local-only). When cloud storage is added,
    route deletion through resource_service.delete_resource() instead.
    """
    records = _load()
    target = next((r for r in records if r["id"] == resource_id), None)
    if target is None:
        return None
    fp = Path(target.get("file_path", ""))
    if fp.exists():
        try:
            fp.unlink()
        except Exception:
            pass
    _save([r for r in records if r["id"] != resource_id])
    return target


def get_resources_dir() -> Path:
    _ensure_dir()
    return _RESOURCES_DIR
