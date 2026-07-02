"""Local image metadata store.

Persists uploaded image info (url, thumb, alt, language, pair, etc.) to
data/images.json so the app has a browseable asset library.

The ImgBB API does not have a list endpoint, so we maintain this ourselves.

Schema (each record):
  id            str   — stable 12-char hex UUID (assigned at upload time)
  url           str   — full-size ImgBB URL
  display_url   str   — viewer URL
  thumb_url     str   — thumbnail URL
  delete_url    str   — ImgBB delete URL
  name          str   — human name
  alt           str   — accessibility alt text
  description   str   — notes
  tags          list  — free-form string tags (e.g. ["flier", "march-2026"])
  uploaded_at   str   — ISO timestamp
  language      str   — "" | "en" | "es"  (empty = used for both)
  pair_id       str?  — shared ID linking EN/ES counterparts (null if standalone)
  event_ids     list  — row_indices (as str) of all linked events (empty list if none)
  meta_version  int   — increments on every metadata update (lightweight history)
  updated_at    str?  — ISO timestamp of last metadata change
"""
import datetime
import json
import uuid
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from core.version import SCHEMA_VERSIONS
from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

_STORE_FILE = Path(__file__).parent / "images.json"
_IMAGES_SCHEMA_VERSION = SCHEMA_VERSIONS["images"]
_CLOUD_KEY = "images"

_DEFAULTS = {
    "tags":         [],
    "language":     "",
    "pair_id":      None,
    "event_ids":    [],
    "job_ids":      [],
    "meta_version": 1,
    "updated_at":   None,
}


def _normalize(img: dict) -> dict:
    """Backfill any missing fields so old records stay compatible."""
    # Migrate old single event_id → event_ids list
    if "event_id" in img:
        old = img.pop("event_id")
        if "event_ids" not in img:
            img["event_ids"] = [str(old)] if old is not None else []
    for k, v in _DEFAULTS.items():
        if k in ("tags", "event_ids", "job_ids"):
            img.setdefault(k, [])
            if not isinstance(img[k], list):
                img[k] = [str(img[k])] if img[k] else []
        else:
            img.setdefault(k, v)
    return img


def _load() -> list[dict]:
    if is_cloud_available():
        raw = cloud_load(_CLOUD_KEY) or {}
    elif _STORE_FILE.exists():
        try:
            raw = json.loads(_STORE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    else:
        return []
    images = raw.get("images", raw) if isinstance(raw, dict) else raw
    return [_normalize(img) for img in images]


def _save(images: list[dict]) -> None:
    envelope = {"_schema_version": _IMAGES_SCHEMA_VERSION, "images": images}
    if is_cloud_available():
        cloud_save(_CLOUD_KEY, envelope)
        return
    _STORE_FILE.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")


def get_images() -> list[dict]:
    return _load()


def add_image(
    url: str,
    display_url: str = "",
    thumb_url: str = "",
    delete_url: str = "",
    name: str = "",
    alt: str = "",
    description: str = "",
    language: str = "",
    tags: list = None,
) -> dict:
    images = _load()
    now = datetime.datetime.now().isoformat()
    record = {
        "id":           uuid.uuid4().hex[:12],
        "url":          url,
        "display_url":  display_url,
        "thumb_url":    thumb_url or url,
        "delete_url":   delete_url,
        "name":         name,
        "alt":          alt,
        "description":  description,
        "tags":         tags if isinstance(tags, list) else [],
        "uploaded_at":  now,
        "language":     language,
        "pair_id":      None,
        "meta_version": 1,
        "updated_at":   None,
    }
    images.insert(0, record)   # newest first
    _save(images)
    return record


def update_image(
    image_id: str,
    alt: str = None,
    description: str = None,
    name: str = None,
    language: str = None,
    tags: list = None,            # list of tag strings; pass [] to clear all tags
    pair_id: str = None,          # use sentinel to distinguish "not passed"
    _clear_pair: bool = False,    # explicitly set pair_id to None
    add_event_id: str = None,        # append to event_ids list
    remove_event_id: str = None,     # remove from event_ids list
    _clear_all_events: bool = False, # set event_ids to []
    add_job_id: str = None,          # append to job_ids list
    remove_job_id: str = None,       # remove from job_ids list
    _clear_all_jobs: bool = False,   # set job_ids to []
) -> dict | None:
    images = _load()
    for img in images:
        if img["id"] == image_id:
            if alt is not None:
                img["alt"] = alt
            if description is not None:
                img["description"] = description
            if name is not None:
                img["name"] = name
            if language is not None:
                img["language"] = language
            if tags is not None:
                img["tags"] = [str(t).strip() for t in tags if str(t).strip()]
            if _clear_pair:
                img["pair_id"] = None
            elif pair_id is not None:
                img["pair_id"] = pair_id
            if _clear_all_events:
                img["event_ids"] = []
            elif remove_event_id is not None:
                key = str(remove_event_id)
                img["event_ids"] = [x for x in img.get("event_ids", []) if x != key]
            elif add_event_id is not None:
                key = str(add_event_id)
                ids = img.get("event_ids", [])
                if key not in ids:
                    ids.append(key)
                img["event_ids"] = ids
            if _clear_all_jobs:
                img["job_ids"] = []
            elif remove_job_id is not None:
                key = str(remove_job_id)
                img["job_ids"] = [x for x in img.get("job_ids", []) if x != key]
            elif add_job_id is not None:
                key = str(add_job_id)
                ids = img.get("job_ids", [])
                if key not in ids:
                    ids.append(key)
                img["job_ids"] = ids
            img["meta_version"] = img.get("meta_version", 1) + 1
            img["updated_at"]   = datetime.datetime.now().isoformat()
            _save(images)
            return img
    return None


def get_all_image_tags() -> list[str]:
    """Return a sorted list of all unique tag strings used across all images."""
    images = _load()
    tags: set[str] = set()
    for img in images:
        for t in img.get("tags") or []:
            if t:
                tags.add(t)
    return sorted(tags)


def pair_images(id1: str, lang1: str, id2: str, lang2: str) -> tuple[dict, dict] | None:
    """Link two images as EN/ES counterparts under a shared pair_id."""
    images = _load()
    img1 = next((i for i in images if i["id"] == id1), None)
    img2 = next((i for i in images if i["id"] == id2), None)
    if not img1 or not img2:
        return None

    # Reuse an existing pair_id if either already has one, otherwise generate
    shared_pair_id = img1.get("pair_id") or img2.get("pair_id") or uuid.uuid4().hex[:10]
    now = datetime.datetime.now().isoformat()

    for img, lang in ((img1, lang1), (img2, lang2)):
        img["pair_id"]      = shared_pair_id
        img["language"]     = lang
        img["meta_version"] = img.get("meta_version", 1) + 1
        img["updated_at"]   = now

    _save(images)
    return img1, img2


def unpair_images(pair_id: str) -> int:
    """Remove the pair linkage from all images sharing pair_id. Returns count updated."""
    images = _load()
    count = 0
    now = datetime.datetime.now().isoformat()
    for img in images:
        if img.get("pair_id") == pair_id:
            img["pair_id"]      = None
            img["meta_version"] = img.get("meta_version", 1) + 1
            img["updated_at"]   = now
            count += 1
    if count:
        _save(images)
    return count


def clear_event_links(event_row_index: int) -> int:
    """Remove event_row_index from event_ids on all linked images. Returns count updated."""
    images = _load()
    count = 0
    now = datetime.datetime.now().isoformat()
    key = str(event_row_index)
    for img in images:
        ids = img.get("event_ids", [])
        if key in ids:
            img["event_ids"]    = [x for x in ids if x != key]
            img["meta_version"] = img.get("meta_version", 1) + 1
            img["updated_at"]   = now
            count += 1
    if count:
        _save(images)
    return count


def delete_image(image_id: str) -> dict | None:
    """Remove from local store. Caller is responsible for hitting ImgBB delete_url if desired."""
    images = _load()
    target = next((img for img in images if img["id"] == image_id), None)
    if target is None:
        return None
    _save([img for img in images if img["id"] != image_id])
    return target
