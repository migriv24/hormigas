"""Central tag registry shared across images, events, contacts, and orgs.

tags.json stores the canonical list of known tag names.
Each entity (image, event, etc.) stores its own tags: [str] array.
This module provides get_suggestions() — the union of all known tags —
and ensure_tag() to register a new tag in the central list.
"""

import json
import threading
from pathlib import Path

from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

_STORE_FILE = Path(__file__).parent / "tags.json"
_CLOUD_KEY  = "tags"
_lock = threading.Lock()


def _load() -> list[str]:
    if is_cloud_available():
        data = cloud_load(_CLOUD_KEY) or {}
        return [str(t) for t in data.get("tags", []) if str(t).strip()]
    try:
        data = json.loads(_STORE_FILE.read_text(encoding="utf-8"))
        return [str(t) for t in data.get("tags", []) if str(t).strip()]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save(tags: list[str]) -> None:
    payload = {"tags": tags}
    if is_cloud_available():
        cloud_save(_CLOUD_KEY, payload)
        return
    _STORE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_registry_tags() -> list[str]:
    """Return tags explicitly registered in tags.json (sorted)."""
    return sorted(set(_load()))


def ensure_tag(name: str) -> None:
    """Add tag to registry if not already present."""
    name = name.strip()
    if not name:
        return
    with _lock:
        tags = _load()
        if name not in tags:
            tags.append(name)
            _save(sorted(set(tags)))


def get_tag_stats() -> list[dict]:
    """Return all tags with usage counts across all stores."""
    import data.image_store as image_store
    import data.events_meta as events_meta
    import data.contacts_meta as contacts_meta
    import data.resource_store as resource_store

    counts: dict[str, int] = {}

    def _bump(tag: str) -> None:
        t = tag.strip()
        if t:
            counts[t] = counts.get(t, 0) + 1

    try:
        for img in image_store.get_images():
            for t in (img.get("tags") or []):
                _bump(t)
    except Exception:
        pass
    try:
        for meta in events_meta.get_all_meta().values():
            for t in meta.get("tags", []):
                _bump(t)
    except Exception:
        pass
    try:
        for meta in contacts_meta.get_all_meta().values():
            for t in meta.get("tags", []):
                _bump(t)
    except Exception:
        pass
    try:
        for res in resource_store.get_resources():
            for t in (res.get("tags") or []):
                _bump(t)
    except Exception:
        pass
    # Ensure registry-only tags appear even with 0 usage
    for t in _load():
        if t not in counts:
            counts[t] = 0

    return sorted([{"name": k, "count": v} for k, v in counts.items()], key=lambda x: x["name"])


def rename_tag(old: str, new: str) -> int:
    """Rename a tag across all stores. Returns total number of entities updated."""
    old, new = old.strip(), new.strip()
    if not old or not new or old == new:
        return 0

    import data.image_store as image_store
    import data.events_meta as events_meta
    import data.contacts_meta as contacts_meta
    import data.resource_store as resource_store

    updated = 0

    # Image store
    try:
        images = image_store.get_images()
        for img in images:
            tags = img.get("tags") or []
            if old in tags:
                new_tags = [new if t == old else t for t in tags]
                image_store.update_image(img["id"], tags=new_tags)
                updated += 1
    except Exception:
        pass

    # Events meta
    try:
        for row_key, meta in events_meta.get_all_meta().items():
            tags = meta.get("tags", [])
            if old in tags:
                meta["tags"] = [new if t == old else t for t in tags]
                events_meta.set_meta(int(row_key), meta)
                updated += 1
    except Exception:
        pass

    # Contacts meta
    try:
        for row_key, meta in contacts_meta.get_all_meta().items():
            tags = meta.get("tags", [])
            if old in tags:
                meta["tags"] = [new if t == old else t for t in tags]
                contacts_meta.set_meta(int(row_key), meta)
                updated += 1
    except Exception:
        pass

    # Resource store
    try:
        for res in resource_store.get_resources():
            tags = res.get("tags") or []
            if old in tags:
                resource_store.update_resource(res["id"], tags=[new if t == old else t for t in tags])
                updated += 1
    except Exception:
        pass

    # Update registry
    with _lock:
        tags = _load()
        if old in tags:
            tags.remove(old)
        if new not in tags:
            tags.append(new)
        _save(sorted(set(tags)))

    return updated


def delete_tag(name: str) -> int:
    """Delete a tag from all stores. Returns count of entities updated."""
    name = name.strip()
    if not name:
        return 0

    import data.image_store as image_store
    import data.events_meta as events_meta
    import data.contacts_meta as contacts_meta
    import data.resource_store as resource_store

    updated = 0

    try:
        images = image_store.get_images()
        for img in images:
            tags = img.get("tags") or []
            if name in tags:
                image_store.update_image(img["id"], tags=[t for t in tags if t != name])
                updated += 1
    except Exception:
        pass
    try:
        for row_key, meta in events_meta.get_all_meta().items():
            tags = meta.get("tags", [])
            if name in tags:
                meta["tags"] = [t for t in tags if t != name]
                events_meta.set_meta(int(row_key), meta)
                updated += 1
    except Exception:
        pass
    try:
        for row_key, meta in contacts_meta.get_all_meta().items():
            tags = meta.get("tags", [])
            if name in tags:
                meta["tags"] = [t for t in tags if t != name]
                contacts_meta.set_meta(int(row_key), meta)
                updated += 1
    except Exception:
        pass
    try:
        for res in resource_store.get_resources():
            tags = res.get("tags") or []
            if name in tags:
                resource_store.update_resource(res["id"], tags=[t for t in tags if t != name])
                updated += 1
    except Exception:
        pass

    with _lock:
        tags = _load()
        if name in tags:
            tags.remove(name)
            _save(sorted(set(tags)))

    return updated


def get_suggestions() -> list[str]:
    """Return sorted union of all known tags (registry + images + events + resources)."""
    known: set[str] = set(_load())

    try:
        import data.image_store as image_store
        known.update(image_store.get_all_image_tags())
    except Exception:
        pass

    try:
        import data.events_meta as events_meta
        for meta in events_meta.get_all_meta().values():
            for t in meta.get("tags", []):
                if t:
                    known.add(t)
    except Exception:
        pass

    try:
        import data.contacts_meta as contacts_meta
        for meta in contacts_meta.get_all_meta().values():
            for t in meta.get("tags", []):
                if t:
                    known.add(t)
    except Exception:
        pass

    try:
        import data.resource_store as resource_store
        for res in resource_store.get_resources():
            for t in (res.get("tags") or []):
                if t:
                    known.add(t)
    except Exception:
        pass

    return sorted(known)
