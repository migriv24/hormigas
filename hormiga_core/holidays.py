"""
holidays — SPEC §10.1: the protocol interface to backends Hormiga does not own.

A holiday is an Antfarm node (ANTFARM.md ⇄ VOIDCORE_INTEGRATION.md §1). Backed
data (contacts, events, images, jobs) is *never* materialized into runes; it is
reached by tag query through these objects:

    query(tagExpr) -> [entity]      get(ref) -> entity
    describe()     -> {kind, capabilities, status, count}

Entities cross as plain dicts. An entity's tag set for matching = its `tags`
list plus a few identity fields (name/title/id), mirroring SPEC §5's rule that
a rune's own name counts as a tag.

Failure honesty: a holiday whose backend is unreachable (the paused Supabase)
answers describe() with status "offline" and raises a clean error from query()
— the app must never die because a node is down (the Antfarm principle).

Tag matching is delegated to Void Core's `tag_match` FFI (the one C
implementation of the SPEC §5 grammar, added in 0.2.0) so a holiday's
`query(expr)` means exactly what the core's `ls --tag expr` means over runes —
no host-side reimplementation to drift.
"""
from __future__ import annotations

from typing import Any, Callable, List

# match(expr, tags) -> bool : the Void Core tag_match FFI, injected by the engine.
Matcher = Callable[[str, List[str]], bool]


class Holiday:
    """Base holiday: subclasses supply _fetch() -> list[dict] and _tag_fields."""

    kind = "data"
    name = "holiday"
    _id_field = "id"
    _tag_fields: tuple[str, ...] = ("name",)   # identity fields that count as tags

    def __init__(self, match: Matcher):
        self._match = match

    def _fetch(self) -> list[dict]:            # pragma: no cover - abstract
        raise NotImplementedError

    def _entity_tags(self, e: dict) -> list[str]:
        tags = [str(t) for t in (e.get("tags") or [])]
        for f in self._tag_fields:
            v = e.get(f)
            if v not in (None, "") and str(v) not in tags:
                tags.append(str(v))
        return tags

    def query(self, expr: str = "") -> list[dict]:
        return [e for e in self._fetch() if self._match(expr, self._entity_tags(e))]

    def get(self, ref: str) -> dict | None:
        for e in self._fetch():
            if str(e.get(self._id_field)) == str(ref) or str(ref) in self._entity_tags(e):
                return e
        return None

    def describe(self) -> dict:
        try:
            entities = self._fetch()
            all_tags: set[str] = set()
            for e in entities:
                all_tags |= {str(t) for t in (e.get("tags") or [])}
            return {"holiday": self.name, "kind": self.kind, "status": "ok",
                    "count": len(entities), "tags": sorted(all_tags)}
        except Exception as exc:
            return {"holiday": self.name, "kind": self.kind, "status": "offline",
                    "error": str(exc)}


class _CallableHoliday(Holiday):
    """A holiday over a fetch function (the thin wrap for existing stores)."""

    def __init__(self, match: Matcher, name: str, fetch: Callable[[], list[dict]],
                 id_field: str = "id", tag_fields: tuple[str, ...] = ("name",)):
        super().__init__(match)
        self.name = name
        self._fetch_fn = fetch
        self._id_field = id_field
        self._tag_fields = tag_fields

    def _fetch(self) -> list[dict]:
        return self._fetch_fn()


def build_registry(get_repo: Callable[[], Any], match: Matcher) -> dict[str, Holiday]:
    """The holiday registry over Hormiga's existing stores. `get_repo` is
    app.py's lazy repository accessor; `match` is Void Core's tag_match FFI."""
    import data.contacts_meta as contacts_meta
    import data.events_meta as events_meta
    import data.image_store as image_store
    import data.jobs_store as jobs_store
    import services.contacts_service as contacts_svc
    import services.events_service as events_svc

    def fetch_contacts() -> list[dict]:
        all_meta = contacts_meta.get_all_meta()
        out = []
        for c in contacts_svc.get_contacts(get_repo()):
            d = c.to_dict()
            d["tags"] = all_meta.get(str(c.row_index), {}).get("tags", [])
            out.append(d)
        return out

    def fetch_events() -> list[dict]:
        all_meta = events_meta.get_all_meta()
        out = []
        for e in events_svc.get_events(get_repo()):
            d = e.to_dict()
            d["tags"] = all_meta.get(str(e.row_index), {}).get("tags", [])
            out.append(d)
        return out

    return {
        "contacts": _CallableHoliday(match, "contacts", fetch_contacts,
                                     id_field="row_index", tag_fields=("name",)),
        "events":   _CallableHoliday(match, "events", fetch_events,
                                     id_field="row_index", tag_fields=("name", "title")),
        "images":   _CallableHoliday(match, "images", image_store.get_images,
                                     id_field="id", tag_fields=("name", "filename")),
        "jobs":     _CallableHoliday(match, "jobs", jobs_store.get_jobs,
                                     id_field="id", tag_fields=("title", "organization")),
    }
