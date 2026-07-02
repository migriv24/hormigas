"""Flask entry point for the Newsletter Creator app.

Dev:        python app.py  (opens browser automatically)
Packaged:   spawned by Electron — browser window managed by Electron
"""
import json
import os
import sys
import webbrowser
from pathlib import Path
from threading import Timer

import requests as _requests

from flask import Flask, jsonify, render_template, request, abort

from core.command import history
from core.exceptions import AppError, SheetError
import services.tunnel_service as tunnel_svc
import data.server_store as server_store
from core.event_bus import bus
from core.logger import get_logger
import data.local_store as store
import data.user_store as user_store
from core.settings import get_settings
from data.cache import cache
from data.repository import BaseRepository
from data.sheets_repository import SheetsRepository
from schemas.contact import Contact
from schemas.event import Event
from schemas.newsletter import NewsletterDoc, NewsletterSection
import services.contacts_service as contacts_svc
import services.events_service as events_svc
import services.orgs_service as orgs_svc
from schemas.organization import Organization
from services.image_service import upload_image
import data.image_store as image_store
import services.link_service as link_svc
import data.events_meta as events_meta
import data.tags_store as tags_store
import data.contacts_meta as contacts_meta
import data.presenter_meta as presenter_meta
from services.newsletter_service import render_email, render_section
from data.graph_store import GraphStore
from dataclasses import asdict as _asdict

logger = get_logger("app")

# When bundled with PyInstaller, static assets live in sys._MEIPASS.
# In dev, they live next to this file as usual.
_FROZEN = getattr(sys, "frozen", False)
_BASE_DIR = sys._MEIPASS if _FROZEN else os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(_BASE_DIR, "templates"),
    static_folder=os.path.join(_BASE_DIR, "static"),
)

# ---------------------------------------------------------------------------
# Repository init (lazy — first request initializes it)
# ---------------------------------------------------------------------------

_repo: BaseRepository | None = None
_sheets_repo: SheetsRepository | None = None   # always available for pull-sheet sync


def get_repo() -> BaseRepository:
    """Return the active repository.

    Priority:
      1. SupabaseRestRepository — when supabase.url + supabase.anon_key are set
         (uses HTTPS REST API, no direct DB connection required)
      2. SheetsRepository      — fallback when no cloud is configured
    """
    global _repo
    if _repo is None:
        from core.settings import is_supabase_configured, get_supabase_url, get_supabase_anon_key
        if is_supabase_configured():
            from data.supabase_repository import SupabaseRestRepository
            from data.db.cloud_store import migrate_local_to_cloud
            migrate_local_to_cloud()
            _repo = SupabaseRestRepository(get_supabase_url(), get_supabase_anon_key())
            logger.info("Using SupabaseRestRepository")
        else:
            _repo = SheetsRepository()
            logger.info("Using SheetsRepository (no supabase config found)")
    return _repo


def _get_sheets_repo() -> SheetsRepository:
    """Always returns a SheetsRepository — used by pull-sheet sync regardless
    of which repository is active for normal reads/writes."""
    global _sheets_repo
    if _sheets_repo is None:
        _sheets_repo = SheetsRepository()
    return _sheets_repo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok(data=None, **kwargs):
    payload = {"ok": True}
    if data is not None:
        payload["data"] = data
    payload.update(kwargs)
    return jsonify(payload)


def _err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def _handle(fn):
    """Decorator: catch AppError and return JSON error responses."""
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except SheetError as exc:
            logger.error(f"SheetError: {exc}")
            return _err(str(exc), 502)
        except AppError as exc:
            logger.error(f"AppError: {exc}")
            return _err(str(exc), 400)
        except _requests.exceptions.ConnectionError as exc:
            logger.error(f"Connection error: {exc}")
            return _err("Cannot reach Supabase — check your internet connection", 503)
        except _requests.exceptions.Timeout as exc:
            logger.error(f"Request timed out: {exc}")
            return _err("Supabase request timed out — check your connection", 503)
        except Exception as exc:
            logger.exception("Unexpected error")
            return _err(f"Unexpected error: {exc}", 500)
    return wrapper


# ---------------------------------------------------------------------------
# Error handlers — always return JSON so apiFetch never gets HTML
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def handle_404(e):
    return _err(f"Not found: {request.path}", 404)


@app.errorhandler(500)
def handle_500(e):
    return _err("Internal server error", 500)


# ---------------------------------------------------------------------------
# App shell
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    """Liveness probe used by Electron to know when the server is ready."""
    return jsonify({"status": "ok"})


@app.route("/api/export-miga")
def api_export_miga():
    """Return a JSON bundle of all credentials for Electron to encrypt into a .miga file.

    Only callable from localhost — Electron fetches this, adds optional password,
    encrypts with AES-256-GCM, and saves the resulting .miga file to disk.
    This endpoint never writes the file itself.
    """
    settings = get_settings()

    # Load Google credentials JSON from disk
    google_creds = None
    creds_path = settings.get("google_credentials_path", "")
    if creds_path:
        # Resolve relative paths against the settings file location
        from core.settings import _SETTINGS_PATH
        resolved = (
            Path(creds_path) if os.path.isabs(creds_path)
            else Path(_SETTINGS_PATH).parent / creds_path
        )
        if resolved.exists():
            with open(resolved, encoding="utf-8") as f:
                google_creds = json.load(f)

    bundle = {
        "version":              2,
        "org_name":             settings.get("newsletter_defaults", {}).get("org_name", ""),
        "supabase_url":         settings.get("supabase", {}).get("url", ""),
        "supabase_anon_key":    settings.get("supabase", {}).get("anon_key", ""),
        # keep legacy field for backward compat — not used when supabase_ fields present
        "database_url":         settings.get("database", {}).get("url", ""),
        "imgbb_api_key":        settings.get("imgbb_api_key", ""),
        "google_sheet_id":      settings.get("google_sheet_id", ""),
        "google_credentials":   google_creds,
        "newsletter_defaults":  settings.get("newsletter_defaults", {}),
        "render_both_languages": settings.get("render_both_languages", False),
        "highlights":           settings.get("highlights", {}),
        "created_by":           "miguel",
        "created_at":           __import__("datetime").date.today().isoformat(),
    }

    return jsonify(bundle)


@app.route("/")
def index():
    return render_template("app/layout.html", settings=get_settings())


# ---------------------------------------------------------------------------
# Status / sync
# ---------------------------------------------------------------------------

@app.route("/api/status")
@_handle
def api_status():
    settings = get_settings()
    return _ok({
        "can_undo": history.can_undo,
        "can_redo": history.can_redo,
        "cache_keys": cache.keys(),
        "sheet_id": settings["google_sheet_id"],
    })


def _diff_records(old: list, new: list, key: str, label_fn) -> dict:
    """Compare two lists of dataclass records by a key field.

    Returns {added, modified, removed} lists with human-readable summaries.
    Each item: {"key": ..., "label": ..., "changes": [...field names...]}
    """
    old_by_key = {getattr(r, key): r for r in old if getattr(r, key) is not None}
    new_by_key = {getattr(r, key): r for r in new if getattr(r, key) is not None}

    added, modified, removed = [], [], []

    for k, rec in new_by_key.items():
        if k not in old_by_key:
            added.append({"key": k, "label": label_fn(rec)})
        else:
            old_rec = old_by_key[k]
            changed_fields = [
                f for f in vars(rec)
                if f not in ("row_index", "color") and getattr(rec, f) != getattr(old_rec, f)
            ]
            if changed_fields:
                modified.append({"key": k, "label": label_fn(rec), "changes": changed_fields})

    for k, rec in old_by_key.items():
        if k not in new_by_key:
            removed.append({"key": k, "label": label_fn(rec)})

    return {"added": added, "modified": modified, "removed": removed}


@app.route("/api/sync/preview", methods=["GET"])
@_handle
def api_sync_preview():
    """Diff Google Sheets (live) against the current data store.

    When using PostgresRepository:
      - Fetches fresh data from Sheets via _get_sheets_repo()
      - Diffs against current Postgres data
      - Caches the fresh Sheet data for the accept step
      - Does NOT write to Postgres yet (user must call POST /api/sync/accept)

    When using SheetsRepository (legacy):
      - Behaves as before — cache invalidate + re-fetch IS the sync
    """
    from core.settings import is_supabase_configured, get_database_url

    repo = get_repo()

    if is_supabase_configured() or get_database_url():
        # ── Cloud mode: compare sheets against DB ─────────────────────────
        sheets = _get_sheets_repo()

        old_contacts   = repo.get_contacts()
        old_events     = repo.get_events()
        old_presenters = repo.get_presenters()

        # Fetch fresh from Sheets and stage in a holding cache
        new_contacts   = sheets.get_contacts()
        new_events     = sheets.get_events()
        new_presenters = sheets.get_presenters()

        # Stage for accept step (short TTL is fine — user will accept quickly)
        cache.set("_pending_contacts",   new_contacts)
        cache.set("_pending_events",     new_events)
        cache.set("_pending_presenters", new_presenters)
    else:
        # ── Sheets mode: cache invalidate + re-fetch (original behaviour) ──
        old_contacts   = cache.get("contacts")   or []
        old_events     = cache.get("events")     or []
        old_presenters = cache.get("presenters") or []

        cache.invalidate("contacts")
        cache.invalidate("events")
        cache.invalidate("presenters")

        new_contacts   = repo.get_contacts()
        new_events     = repo.get_events()
        new_presenters = repo.get_presenters()

    contacts_diff   = _diff_records(old_contacts,   new_contacts,   "row_index", lambda c: c.name)
    events_diff     = _diff_records(old_events,     new_events,     "row_index", lambda e: e.title)
    presenters_diff = _diff_records(old_presenters, new_presenters, "row_index", lambda p: p.name)

    has_changes = any(
        len(d[k]) > 0
        for d in (contacts_diff, events_diff, presenters_diff)
        for k in ("added", "modified", "removed")
    )

    logger.info(f"Sync preview: contacts={contacts_diff}, events={events_diff}")
    return _ok({
        "identical": not has_changes,
        "contacts":   contacts_diff,
        "events":     events_diff,
        "presenters": presenters_diff,
        "totals": {
            "contacts":   len(new_contacts),
            "events":     len(new_events),
            "presenters": len(new_presenters),
        },
    })


@app.route("/api/sync/accept", methods=["POST"])
@_handle
def api_sync_accept():
    """Commit the staged sheet data into Postgres after the user accepts the diff.

    Only meaningful in Postgres mode — in Sheets mode the preview already
    updated the cache, so this is a no-op that returns ok.
    """
    from core.settings import is_supabase_configured, get_database_url

    if not is_supabase_configured() and not get_database_url():
        return _ok({"message": "no-op in sheets mode"})

    repo = get_repo()
    from data.supabase_repository import SupabaseRestRepository
    from data.postgres_repository import PostgresRepository
    if not isinstance(repo, (SupabaseRestRepository, PostgresRepository)):
        return _ok({"message": "no-op"})

    contacts   = cache.get("_pending_contacts")   or []
    events     = cache.get("_pending_events")     or []
    presenters = cache.get("_pending_presenters") or []

    counts = repo.upsert_from_sheets(
        contacts=contacts,
        events=events,
        presenters=presenters,
        orgs=[],  # orgs come from a separate populate step
    )

    cache.invalidate("_pending_contacts")
    cache.invalidate("_pending_events")
    cache.invalidate("_pending_presenters")

    logger.info(f"Sync accepted: {counts}")
    return _ok(counts)


@app.route("/api/sync", methods=["POST"])
@_handle
def api_sync():
    """Force-refresh everything from Sheets.

    In Postgres mode: fetches fresh sheet data and upserts into Postgres.
    In Sheets mode: clears cache and re-fetches (original behaviour).
    """
    from core.settings import is_supabase_configured, get_database_url
    cache.clear()
    repo = get_repo()

    if is_supabase_configured() or get_database_url():
        from data.supabase_repository import SupabaseRestRepository
        from data.postgres_repository import PostgresRepository
        if isinstance(repo, (SupabaseRestRepository, PostgresRepository)):
            sheets = _get_sheets_repo()
            contacts   = sheets.get_contacts()
            events     = sheets.get_events()
            presenters = sheets.get_presenters()
            orgs       = sheets.get_organizations()
            repo.upsert_from_sheets(contacts, events, presenters, orgs)
            logger.info("Force sync from Sheets → cloud complete")
            return _ok({"contacts": len(contacts), "events": len(events),
                        "presenters": len(presenters), "orgs": len(orgs)})

    contacts   = repo.get_contacts()
    events     = repo.get_events()
    presenters = repo.get_presenters()
    logger.info("Manual sync complete")
    return _ok({
        "contacts": len(contacts),
        "events": len(events),
        "presenters": len(presenters),
    })


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

@app.route("/api/contacts")
@_handle
def api_get_contacts():
    contacts = contacts_svc.get_contacts(get_repo())
    query = request.args.get("q", "").strip()
    tag_filter = request.args.get("tags", "").strip()
    if query:
        contacts = contacts_svc.search_contacts(contacts, query)
    all_meta = contacts_meta.get_all_meta()
    # Merge tags from meta; optionally filter by tag expression
    result = []
    for c in contacts:
        d = c.to_dict()
        d["tags"] = all_meta.get(str(c.row_index), {}).get("tags", [])
        result.append(d)
    if tag_filter:
        result = contacts_svc.filter_by_tags(result, tag_filter)
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    total = len(result)
    start = (page - 1) * per_page
    return _ok(
        result[start: start + per_page],
        total=total,
        page=page,
        per_page=per_page,
        pages=((total - 1) // per_page) + 1 if total else 1,
    )


@app.route("/api/contacts/<int:row_index>/meta", methods=["PATCH"])
@_handle
def api_update_contact_meta(row_index: int):
    body = request.get_json(force=True)
    updated = contacts_meta.set_meta(row_index, body)
    return _ok(updated)


@app.route("/api/contacts", methods=["POST"])
@_handle
def api_add_contact():
    data = request.get_json(force=True)
    contact = contacts_svc.add_contact(get_repo(), data)
    return _ok(contact.to_dict()), 201


@app.route("/api/contacts/<int:row_index>", methods=["PUT"])
@_handle
def api_update_contact(row_index: int):
    contacts = contacts_svc.get_contacts(get_repo())
    old = next((c for c in contacts if c.row_index == row_index), None)
    if old is None:
        return _err(f"Contact at row {row_index} not found", 404)
    data = request.get_json(force=True)
    new = contacts_svc.update_contact(get_repo(), old, data)
    return _ok(new.to_dict())


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@app.route("/api/events")
@_handle
def api_get_events():
    events = events_svc.get_events(get_repo())
    all_meta = events_meta.get_all_meta()
    result = []
    for e in events:
        d = e.to_dict()
        meta = all_meta.get(str(e.row_index), {})
        d["tags"] = meta.get("tags", [])
        if meta.get("icon_url"):
            d["icon_url"] = meta["icon_url"]
        result.append(d)
    return _ok(result)


@app.route("/api/events", methods=["POST"])
@_handle
def api_add_event():
    data = request.get_json(force=True)
    events_svc.add_event(get_repo(), data)
    # Re-fetch to get the assigned row_index (append_row doesn't return it)
    events = events_svc.get_events(get_repo())
    title = data.get("title", "")
    # Find the newly added event — last match by title is safest for appends
    matches = [e for e in events if e.title == title]
    new_event = matches[-1] if matches else None
    d = new_event.to_dict() if new_event else {"title": title}
    return _ok(d), 201


@app.route("/api/events/<int:row_index>", methods=["PUT"])
@_handle
def api_update_event(row_index: int):
    events = events_svc.get_events(get_repo())
    old = next((e for e in events if e.row_index == row_index), None)
    if old is None:
        return _err(f"Event at row {row_index} not found", 404)
    data = request.get_json(force=True)
    new = events_svc.update_event(get_repo(), old, data)
    return _ok(new.to_dict())


@app.route("/api/events/<int:row_index>", methods=["DELETE"])
@_handle
def api_delete_event(row_index: int):
    events = events_svc.get_events(get_repo())
    event = next((e for e in events if e.row_index == row_index), None)
    if event is None:
        return _err(f"Event at row {row_index} not found", 404)
    events_svc.delete_event(get_repo(), event)
    link_svc.on_event_deleted(row_index)
    events_meta.delete_meta(row_index)
    return _ok({"deleted": row_index})


@app.route("/api/events/<int:row_index>/meta", methods=["PATCH"])
@_handle
def api_update_event_meta(row_index: int):
    body = request.get_json(force=True)
    updated = events_meta.set_meta(row_index, body)
    return _ok(updated)


@app.route("/api/images/<image_id>/link-event", methods=["POST"])
@_handle
def api_link_image_to_event(image_id: str):
    body = request.get_json(force=True)
    row_index = body.get("event_row_index")
    if row_index is None:
        return _err("event_row_index required", 400)
    updated = link_svc.link_image_to_event(image_id, int(row_index))
    if updated is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok(updated)


@app.route("/api/images/<image_id>/link-event", methods=["DELETE"])
@_handle
def api_unlink_image_from_event(image_id: str):
    body = request.get_json(force=True) or {}
    row_index = body.get("event_row_index")
    if row_index is None:
        return _err("event_row_index required", 400)
    updated = link_svc.unlink_image_from_event(image_id, int(row_index))
    if updated is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok(updated)


@app.route("/api/events/<int:row_index>/images", methods=["GET"])
@_handle
def api_get_event_images(row_index: int):
    images = link_svc.get_images_for_event(row_index)
    return _ok(images)


# ---------------------------------------------------------------------------
# Presenters
# ---------------------------------------------------------------------------

@app.route("/api/presenters")
@_handle
def api_get_presenters():
    repo = get_repo()
    presenters = repo.get_presenters()
    all_meta = presenter_meta.get_all_meta()
    result = []
    for p in presenters:
        d = p.to_dict()
        meta = all_meta.get(str(p.row_index), {})
        d["tags"] = meta.get("tags", [])
        d["resource_links"] = meta.get("resource_links", [])
        result.append(d)
    return _ok(result)


@app.route("/api/presenters/<int:row_index>/meta", methods=["PATCH"])
@_handle
def api_update_presenter_meta(row_index: int):
    body = request.get_json(force=True)
    updated = presenter_meta.set_meta(row_index, body)
    return _ok(updated)


@app.route("/api/presenters", methods=["POST"])
@_handle
def api_add_presenter():
    from schemas.presenter import Presenter
    data = request.get_json(force=True)
    p = Presenter(
        name=data.get("name", ""),
        organization=data.get("organization", ""),
        slides_link=data.get("slides_link", ""),
        presentation_month=data.get("presentation_month", ""),
        description=data.get("description", ""),
        presentation_year=data.get("presentation_year", ""),
    )
    get_repo().add_presenter(p)
    return _ok(p.to_dict()), 201


@app.route("/api/presenters/<int:row_index>", methods=["PUT"])
@_handle
def api_update_presenter(row_index: int):
    repo = get_repo()
    presenters = repo.get_presenters()
    old = next((p for p in presenters if p.row_index == row_index), None)
    if old is None:
        return _err(f"Presenter at row {row_index} not found", 404)
    from schemas.presenter import Presenter
    data = request.get_json(force=True)
    new = Presenter(
        name=data.get("name", old.name),
        organization=data.get("organization", old.organization),
        slides_link=data.get("slides_link", old.slides_link),
        presentation_month=data.get("presentation_month", old.presentation_month),
        description=data.get("description", old.description),
        presentation_year=data.get("presentation_year", old.presentation_year),
        row_index=old.row_index,
    )
    repo.update_presenter(new)
    return _ok(new.to_dict())


@app.route("/api/presenters/<int:row_index>", methods=["DELETE"])
@_handle
def api_delete_presenter(row_index: int):
    repo = get_repo()
    presenters = repo.get_presenters()
    presenter = next((p for p in presenters if p.row_index == row_index), None)
    if presenter is None:
        return _err(f"Presenter at row {row_index} not found", 404)
    repo.delete_presenter(presenter)
    presenter_meta.delete_meta(row_index)
    return _ok({"deleted": row_index})


# ---------------------------------------------------------------------------
# Image upload
# ---------------------------------------------------------------------------

@app.route("/api/upload-image", methods=["POST"])
@_handle
def api_upload_image():
    name = request.form.get("name", "")
    if "file" in request.files:
        f = request.files["file"]
        import tempfile, os
        suffix = os.path.splitext(f.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            f.save(tmp.name)
            result = upload_image(file_path=tmp.name, name=name or f.filename)
        os.unlink(tmp.name)
    elif request.is_json:
        body = request.get_json(force=True)
        result = upload_image(base64_data=body.get("base64"), name=name)
    else:
        return _err("Provide a file upload or JSON with base64 field")
    return _ok(result), 201


# ---------------------------------------------------------------------------
# Image library (metadata CRUD — actual hosting is ImgBB)
# ---------------------------------------------------------------------------

@app.route("/api/images", methods=["GET"])
@_handle
def api_get_images():
    return _ok(image_store.get_images())


@app.route("/api/tags", methods=["GET"])
@_handle
def api_get_all_tags():
    return _ok(tags_store.get_suggestions())


@app.route("/api/tags", methods=["POST"])
@_handle
def api_ensure_tag():
    body = request.get_json(force=True)
    tags_store.ensure_tag(body.get("name", ""))
    return _ok(tags_store.get_suggestions())


@app.route("/api/tags/stats", methods=["GET"])
@_handle
def api_tag_stats():
    return _ok(tags_store.get_tag_stats())


@app.route("/api/tags/rename", methods=["POST"])
@_handle
def api_rename_tag():
    body = request.get_json(force=True)
    old = body.get("old", "").strip()
    new = body.get("new", "").strip()
    if not old or not new:
        return _err("'old' and 'new' are required", 400)
    updated = tags_store.rename_tag(old, new)
    return _ok({"updated": updated, "old": old, "new": new})


@app.route("/api/tags/delete", methods=["POST"])
@_handle
def api_delete_tag():
    body = request.get_json(force=True)
    name = body.get("name", "").strip()
    if not name:
        return _err("'name' is required", 400)
    updated = tags_store.delete_tag(name)
    return _ok({"updated": updated, "name": name})


@app.route("/api/tags/<tag_name>/entities", methods=["GET"])
@_handle
def api_tag_entities(tag_name: str):
    """Return all entities (images, events, contacts) that carry the given tag."""
    result = {"images": [], "events": [], "contacts": []}

    # Images
    try:
        for img in image_store.get_images():
            if tag_name in (img.get("tags") or []):
                result["images"].append({
                    "id":       img.get("id", ""),
                    "name":     img.get("name") or img.get("id", ""),
                    "url":      img.get("url", ""),
                    "language": img.get("language", ""),
                })
    except Exception:
        pass

    # Events — meta gives row_index; look up title from cached events
    try:
        cached_events = {str(e.row_index): e.title for e in events_svc.get_events(get_repo())}
        for row_key, meta in events_meta.get_all_meta().items():
            if tag_name in meta.get("tags", []):
                result["events"].append({
                    "row_index": int(row_key),
                    "title": cached_events.get(str(row_key), f"Event #{row_key}"),
                })
    except Exception:
        pass

    # Contacts — meta gives row_index; look up name from cached contacts
    try:
        cached_contacts = {str(c.row_index): c.name for c in contacts_svc.get_contacts(get_repo())}
        for row_key, meta in contacts_meta.get_all_meta().items():
            if tag_name in meta.get("tags", []):
                result["contacts"].append({
                    "row_index": int(row_key),
                    "name": cached_contacts.get(str(row_key), f"Contact #{row_key}"),
                })
    except Exception:
        pass

    return _ok(result)


@app.route("/api/images/tags", methods=["GET"])
@_handle
def api_get_image_tags():
    return _ok(image_store.get_all_image_tags())


@app.route("/api/images/<image_id>", methods=["PATCH"])
@_handle
def api_update_image(image_id: str):
    body = request.get_json(force=True)
    # Only pass tags if the key is explicitly present in the request body
    tags = body["tags"] if "tags" in body else None
    updated = image_store.update_image(
        image_id,
        alt=body.get("alt"),
        description=body.get("description"),
        name=body.get("name"),
        language=body.get("language"),   # "" | "en" | "es"
        tags=tags,
    )
    if updated is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok(updated)


@app.route("/api/images/pair", methods=["POST"])
@_handle
def api_pair_images():
    body = request.get_json(force=True)
    result = image_store.pair_images(
        body["id1"], body.get("lang1", "en"),
        body["id2"], body.get("lang2", "es"),
    )
    if result is None:
        return _err("One or both image IDs not found", 404)
    return _ok({"image1": result[0], "image2": result[1]})


@app.route("/api/images/pair/<pair_id>", methods=["DELETE"])
@_handle
def api_unpair_images(pair_id: str):
    count = image_store.unpair_images(pair_id)
    return _ok({"unlinked": count})


@app.route("/api/images/import", methods=["POST"])
@_handle
def api_import_images():
    body = request.get_json(force=True)
    urls = [u.strip() for u in body.get("urls", []) if u.strip()]
    existing_urls = {img["url"] for img in image_store.get_images()}
    added = []
    for url in urls:
        if url in existing_urls:
            continue
        # Derive a friendly name from the filename in the URL
        filename = url.rstrip("/").split("/")[-1]
        name = filename.rsplit(".", 1)[0].replace("-", " ").replace("_", " ")
        record = image_store.add_image(url=url, display_url=url, thumb_url=url, name=name)
        added.append(record)
        existing_urls.add(url)
    return _ok({"imported": len(added), "skipped": len(urls) - len(added)})


@app.route("/api/images/<image_id>", methods=["DELETE"])
@_handle
def api_delete_image(image_id: str):
    deleted = image_store.delete_image(image_id)
    if deleted is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok({"deleted": image_id, "delete_url": deleted.get("delete_url", "")})


# ---------------------------------------------------------------------------
# Resources (attached files — PDFs, etc.)
# ---------------------------------------------------------------------------

@app.route("/api/resources", methods=["GET"])
@_handle
def api_list_resources():
    import data.resource_store as resource_store
    return _ok(resource_store.get_resources())


@app.route("/api/resources", methods=["POST"])
@_handle
def api_upload_resource():
    from services.resource_service import upload_resource
    if "file" not in request.files:
        return _err("No file provided", 400)
    f = request.files["file"]
    if not f.filename:
        return _err("Empty filename", 400)
    display_name = request.form.get("display_name", "").strip()
    tags_raw     = request.form.get("tags", "")
    tags         = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []
    language     = request.form.get("language", "").strip()
    file_bytes   = f.read()
    record = upload_resource(file_bytes, f.filename, display_name=display_name, tags=tags, language=language)
    return _ok(record), 201


@app.route("/api/resources/from-path", methods=["POST"])
@_handle
def api_upload_resource_from_path():
    from services.resource_service import upload_resource
    body         = request.get_json(force=True)
    file_path    = (body.get("file_path") or "").strip()
    if not file_path:
        return _err("file_path required", 400)
    import os
    if not os.path.isfile(file_path):
        return _err("File not found: " + file_path, 400)
    display_name = (body.get("display_name") or "").strip()
    tags_raw     = body.get("tags", "")
    tags         = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []
    language     = (body.get("language") or "").strip()
    filename     = os.path.basename(file_path)
    with open(file_path, "rb") as fh:
        file_bytes = fh.read()
    record = upload_resource(file_bytes, filename, display_name=display_name, tags=tags, language=language)
    return _ok(record), 201


@app.route("/api/resources/<resource_id>", methods=["PATCH"])
@_handle
def api_update_resource(resource_id: str):
    import data.resource_store as resource_store
    body    = request.get_json(force=True)
    allowed = ("display_name", "description", "tags", "language")
    kwargs  = {k: body[k] for k in allowed if k in body}
    updated = resource_store.update_resource(resource_id, **kwargs)
    if updated is None:
        return _err(f"Resource '{resource_id}' not found", 404)
    return _ok(updated)


@app.route("/api/resources/<resource_id>", methods=["DELETE"])
@_handle
def api_delete_resource(resource_id: str):
    import data.resource_store as resource_store
    deleted = resource_store.delete_resource(resource_id)
    if deleted is None:
        return _err(f"Resource '{resource_id}' not found", 404)
    return _ok({"deleted": resource_id})


@app.route("/api/resources/<r1>/pair", methods=["POST"])
@_handle
def api_pair_resources(r1: str):
    from data.resource_store import pair_resources
    body  = request.get_json(force=True)
    r2    = body.get("resource_id", "").strip()
    lang1 = body.get("lang1", "en")
    lang2 = body.get("lang2", "es")
    if not r2:
        return _err("resource_id required", 400)
    result = pair_resources(r1, lang1, r2, lang2)
    if result is None:
        return _err("One or both resources not found", 404)
    return _ok({"resources": list(result)})


@app.route("/api/resources/<resource_id>/unpair", methods=["POST"])
@_handle
def api_unpair_resources(resource_id: str):
    from data.resource_store import get_resource, unpair_resources
    rec = get_resource(resource_id)
    if rec is None:
        return _err(f"Resource '{resource_id}' not found", 404)
    pair_id = rec.get("pair_id")
    if not pair_id:
        return _err("Resource is not paired", 400)
    updated = unpair_resources(pair_id)
    return _ok({"resources": updated})


@app.route("/api/resources/<resource_id>/generate-graphic", methods=["POST"])
@_handle
def api_generate_resource_graphic(resource_id: str):
    from services.resource_service import generate_graphic
    body = request.get_json(force=True, silent=True) or {}
    pages = body.get("pages")  # optional list of page indices
    extra_tags = body.get("extra_tags", [])
    try:
        updated = generate_graphic(resource_id, pages=pages, extra_tags=extra_tags)
    except (ValueError, FileNotFoundError) as exc:
        return _err(str(exc), 404)
    except ImportError as exc:
        return _err(str(exc), 500)
    return _ok(updated)


# ---------------------------------------------------------------------------
# Autocomplete helpers (backed by contacts cache)
# ---------------------------------------------------------------------------

@app.route("/api/autocomplete/names")
@_handle
def api_autocomplete_names():
    contacts = contacts_svc.get_contacts(get_repo())
    names = sorted({c.name for c in contacts if c.name})
    return _ok(names)


@app.route("/api/autocomplete/orgs")
@_handle
def api_autocomplete_orgs():
    contacts = contacts_svc.get_contacts(get_repo())
    orgs = sorted({c.organization for c in contacts if c.organization})
    return _ok(orgs)


@app.route("/api/autocomplete/emails")
@_handle
def api_autocomplete_emails():
    contacts = contacts_svc.get_contacts(get_repo())
    emails = sorted({c.email for c in contacts if c.email})
    return _ok(emails)


# ---------------------------------------------------------------------------
# Graph / Connections Manager
# ---------------------------------------------------------------------------

@app.route("/api/graph", methods=["GET"])
@_handle
def api_graph_all():
    return _ok(GraphStore.get().to_dict())


@app.route("/api/graph/nodes", methods=["GET"])
@_handle
def api_graph_get_nodes():
    type_filter = request.args.get("type")
    nodes = GraphStore.get().get_nodes(type=type_filter or None)
    return _ok([_asdict(n) for n in nodes])


@app.route("/api/graph/nodes", methods=["POST"])
@_handle
def api_graph_add_node():
    body  = request.get_json(force=True)
    label = body.get("label", "").strip()
    if not label:
        return _err("label is required")
    node = GraphStore.get().add_node(
        type=body.get("type", "contact"),
        label=label,
        color=body.get("color"),
        attrs=body.get("attrs", {}),
    )
    return _ok(_asdict(node)), 201


@app.route("/api/graph/nodes/<node_id>", methods=["PATCH"])
@_handle
def api_graph_update_node(node_id: str):
    body = request.get_json(force=True)
    allowed = {"label", "color", "attrs", "stale"}
    updates = {k: v for k, v in body.items() if k in allowed}
    node = GraphStore.get().update_node(node_id, **updates)
    if not node:
        return _err(f"Node '{node_id}' not found", 404)
    return _ok(_asdict(node))


@app.route("/api/graph/nodes/<node_id>", methods=["DELETE"])
@_handle
def api_graph_delete_node(node_id: str):
    ok = GraphStore.get().delete_node(node_id)
    if not ok:
        return _err(f"Node '{node_id}' not found", 404)
    return _ok({"deleted": node_id})


@app.route("/api/graph/edges", methods=["GET"])
@_handle
def api_graph_get_edges():
    gs       = GraphStore.get()
    from_id  = request.args.get("from_id")
    to_id    = request.args.get("to_id")
    relation = request.args.get("relation")
    edges    = gs.get_edges(from_id=from_id, to_id=to_id, relation=relation)
    return _ok([_asdict(e) for e in edges])


@app.route("/api/graph/edges", methods=["POST"])
@_handle
def api_graph_add_edge():
    body     = request.get_json(force=True)
    from_id  = body.get("from_id", "")
    to_id    = body.get("to_id", "")
    relation = body.get("relation", "connected_to")
    if not from_id or not to_id:
        return _err("from_id and to_id are required")
    edge = GraphStore.get().add_edge(from_id, to_id, relation, attrs=body.get("attrs", {}))
    if not edge:
        return _err("One or both nodes not found", 404)
    return _ok(_asdict(edge)), 201


@app.route("/api/graph/edges/<edge_id>", methods=["DELETE"])
@_handle
def api_graph_delete_edge(edge_id: str):
    ok = GraphStore.get().delete_edge(edge_id)
    if not ok:
        return _err(f"Edge '{edge_id}' not found", 404)
    return _ok({"deleted": edge_id})


@app.route("/api/graph/neighbors/<node_id>", methods=["GET"])
@_handle
def api_graph_neighbors(node_id: str):
    relation  = request.args.get("relation")
    direction = request.args.get("direction", "both")
    neighbors = GraphStore.get().neighbors(node_id, relation=relation, direction=direction)
    return _ok([_asdict(n) for n in neighbors])


@app.route("/api/graph/subgraph/<node_id>", methods=["GET"])
@_handle
def api_graph_subgraph(node_id: str):
    depth = int(request.args.get("depth", 1))
    return _ok(GraphStore.get().subgraph(node_id, depth=depth))


@app.route("/api/graph/sync", methods=["POST"])
@_handle
def api_graph_sync():
    gs       = GraphStore.get()
    contacts = contacts_svc.get_contacts(get_repo())
    orgs     = get_repo().get_organizations()
    events   = events_svc.get_events(get_repo())
    images   = image_store.get_images()
    nc       = gs.sync_contacts(contacts)
    no       = gs.sync_orgs(orgs)
    nev      = gs.sync_events(events)
    nim      = gs.sync_images(images)
    logger.info(f"Graph sync: {nc} contacts, {no} orgs, {nev} events, {nim} images")
    return _ok({"contacts_synced": nc, "orgs_synced": no, "events_synced": nev, "images_synced": nim})


# ---------------------------------------------------------------------------
# Undo / Redo
# ---------------------------------------------------------------------------

@app.route("/api/undo", methods=["POST"])
@_handle
def api_undo():
    desc = history.undo()
    return _ok({"undone": desc, "can_undo": history.can_undo, "can_redo": history.can_redo})


@app.route("/api/redo", methods=["POST"])
@_handle
def api_redo():
    desc = history.redo()
    return _ok({"redone": desc, "can_undo": history.can_undo, "can_redo": history.can_redo})


# ---------------------------------------------------------------------------
# Newsletter
# ---------------------------------------------------------------------------

@app.route("/api/newsletter/preview-section", methods=["POST"])
@_handle
def api_preview_section():
    body = request.get_json(force=True)
    section = NewsletterSection.from_dict(body)
    lang = body.get("lang", "en")
    html = render_section(section, lang=lang)
    return _ok({"html": html})


@app.route("/api/newsletter/export", methods=["POST"])
@_handle
def api_newsletter_export():
    body = request.get_json(force=True)
    languages = body.get("languages", "both")   # "en" | "es" | "both"
    base = {"month": body.get("month", ""), "subtitle": body.get("subtitle", "")}

    html_en = None
    html_es = None

    if languages in ("en", "both"):
        secs = body.get("sections_en") or body.get("sections", [])
        doc_en = NewsletterDoc.from_dict({**base, "language": "en", "sections": secs})
        # EN is always skip_translation=True (native language, no translation needed)
        html_en = render_email(doc_en, skip_translation=True)

    if languages in ("es", "both"):
        secs_es = body.get("sections_es")
        if secs_es:
            # Pre-translated canvas: render directly without translation
            doc_es = NewsletterDoc.from_dict({**base, "language": "es", "sections": secs_es})
            html_es = render_email(doc_es, skip_translation=True)
        else:
            # Legacy / no ES canvas yet: translate EN sections on-the-fly
            secs_en = body.get("sections_en") or body.get("sections", [])
            doc_es = NewsletterDoc.from_dict({**base, "language": "es", "sections": secs_en})
            html_es = render_email(doc_es, skip_translation=False)

    return _ok({"html_en": html_en, "html_es": html_es})


@app.route("/api/newsletter/translate", methods=["POST"])
@_handle
def api_newsletter_translate():
    """Translate a list of section dicts to the target language.

    Body: { sections: [...], to_lang: "es" }
    Returns: { sections: [...] }  (same IDs, translated text, tag-driven images cleared)
    """
    from services.newsletter_service import translate_sections
    body = request.get_json(force=True)
    sections = body.get("sections", [])
    to_lang  = body.get("to_lang", "es")
    translated = translate_sections(sections, to_lang)
    return _ok({"sections": translated})


# ---------------------------------------------------------------------------
# Settings reload + save
# ---------------------------------------------------------------------------

@app.route("/api/settings/reload", methods=["POST"])
@_handle
def api_reload_settings():
    from core.settings import reload_settings
    reload_settings()
    return _ok({"reloaded": True})


@app.route("/api/settings", methods=["GET"])
@_handle
def api_get_settings():
    return _ok(get_settings())


@app.route("/api/settings", methods=["POST"])
@_handle
def api_save_settings():
    import json as _json
    from pathlib import Path
    from core.settings import reload_settings
    updates = request.get_json(force=True)
    settings_path = Path("settings.json")
    current = get_settings().copy()
    # Deep merge nested dicts if present
    for nested_key in ("newsletter_defaults", "highlights"):
        if nested_key in updates and isinstance(updates[nested_key], dict):
            current.setdefault(nested_key, {}).update(updates[nested_key])
            updates.pop(nested_key)
    current.update(updates)
    settings_path.write_text(_json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    reload_settings()
    logger.info("Settings saved via UI")
    return _ok({"saved": True})


# ---------------------------------------------------------------------------
# User profile
# ---------------------------------------------------------------------------

@app.route("/api/user/profile", methods=["GET"])
@_handle
def api_get_user_profile():
    return _ok(user_store.get_profile())


@app.route("/api/user/profile", methods=["POST"])
@_handle
def api_save_user_profile():
    updates = request.get_json(force=True)
    profile = user_store.save_profile(updates)
    return _ok(profile)


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------

@app.route("/api/presets", methods=["GET"])
@_handle
def api_get_presets():
    return _ok(store.get_presets())


@app.route("/api/presets", methods=["POST"])
@_handle
def api_save_preset():
    body = request.get_json(force=True)
    name = body.get("name", "").strip()
    if not name:
        return _err("name is required")
    preset = store.save_preset(
        name=name,
        section_type=body.get("section_type", ""),
        data=body.get("data", {}),
    )
    return _ok(preset), 201


@app.route("/api/presets/<preset_id>", methods=["DELETE"])
@_handle
def api_delete_preset(preset_id: str):
    deleted = store.delete_preset(preset_id)
    if not deleted:
        return _err(f"Preset '{preset_id}' not found", 404)
    return _ok({"deleted": preset_id})


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@app.route("/api/projects", methods=["GET"])
@_handle
def api_list_projects():
    return _ok(store.list_projects())


@app.route("/api/projects/<filename>", methods=["GET"])
@_handle
def api_load_project(filename: str):
    doc = store.load_project(filename)
    if doc is None:
        return _err(f"Project '{filename}' not found", 404)
    return _ok(doc)


@app.route("/api/projects/<filename>", methods=["POST", "PUT"])
@_handle
def api_save_project(filename: str):
    doc = request.get_json(force=True)
    slug = store.save_project(filename, doc)
    logger.info(f"Saved project: {slug}")
    return _ok({"slug": slug})


@app.route("/api/projects/<filename>", methods=["DELETE"])
@_handle
def api_delete_project(filename: str):
    deleted = store.delete_project(filename)
    if not deleted:
        return _err(f"Project '{filename}' not found", 404)
    return _ok({"deleted": filename})


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

@app.route("/api/templates", methods=["GET"])
@_handle
def api_list_templates():
    return _ok(store.list_templates())


@app.route("/api/templates/<filename>", methods=["GET"])
@_handle
def api_load_template(filename: str):
    doc = store.load_template(filename)
    if doc is None:
        return _err(f"Template '{filename}' not found", 404)
    return _ok(doc)


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

@app.route("/api/organizations", methods=["GET"])
@_handle
def api_get_orgs():
    orgs = get_repo().get_organizations()
    return _ok([o.to_dict() for o in orgs])


@app.route("/api/organizations", methods=["POST"])
@_handle
def api_add_org():
    data = request.get_json(force=True)
    org = Organization(
        name           = data.get("name", "").strip(),
        abbreviation   = data.get("abbreviation", ""),
        alternate_name = data.get("alternate_name", ""),
        primary_contact= data.get("primary_contact", ""),
        contact_email  = data.get("contact_email", ""),
        website        = data.get("website", ""),
        location       = data.get("location", ""),
        description    = data.get("description", ""),
        image_url      = data.get("image_url", ""),
    )
    if not org.name:
        return _err("name is required")
    get_repo().add_organization(org)
    return _ok(org.to_dict()), 201


@app.route("/api/organizations/<int:row_index>", methods=["PUT"])
@_handle
def api_update_org(row_index: int):
    orgs = get_repo().get_organizations()
    old = next((o for o in orgs if o.row_index == row_index), None)
    if old is None:
        return _err(f"Organization at row {row_index} not found", 404)
    data = request.get_json(force=True)
    new = Organization(
        name           = data.get("name",            old.name),
        abbreviation   = data.get("abbreviation",    old.abbreviation),
        alternate_name = data.get("alternate_name",  old.alternate_name),
        primary_contact= data.get("primary_contact", old.primary_contact),
        contact_email  = data.get("contact_email",   old.contact_email),
        website        = data.get("website",         old.website),
        location       = data.get("location",        old.location),
        description    = data.get("description",     old.description),
        image_url      = data.get("image_url",       old.image_url),
        row_index      = old.row_index,
    )
    get_repo().update_organization(new)
    return _ok(new.to_dict())


@app.route("/api/organizations/<int:row_index>", methods=["DELETE"])
@_handle
def api_delete_org(row_index: int):
    orgs = get_repo().get_organizations()
    org = next((o for o in orgs if o.row_index == row_index), None)
    if org is None:
        return _err(f"Organization at row {row_index} not found", 404)
    get_repo().delete_organization(org)
    return _ok({"deleted": row_index})


@app.route("/api/organizations/detect", methods=["GET"])
@_handle
def api_detect_orgs():
    """Run detection against cached contacts + events. No sheet writes."""
    import services.contacts_service as _cs
    import services.events_service as _es
    contacts = _cs.get_contacts(get_repo())
    events   = _es.get_events(get_repo())
    detected = orgs_svc.detect_organizations(contacts, events)
    return _ok(detected)


@app.route("/api/organizations/populate", methods=["POST"])
@_handle
def api_populate_orgs():
    """Write a finalized org list to the sheet. This is the 'finalize' action."""
    body        = request.get_json(force=True)
    append_only = body.get("append_only", False)
    raw_orgs    = body.get("organizations", [])
    orgs = [
        Organization(
            name           = o.get("name", "").strip(),
            abbreviation   = o.get("abbreviation", ""),
            alternate_name = o.get("alternate_name", ""),
            primary_contact= o.get("primary_contact", ""),
            contact_email  = o.get("contact_email", ""),
            website        = o.get("website", ""),
            location       = o.get("location", ""),
            description    = o.get("description", ""),
            image_url      = o.get("image_url", ""),
        )
        for o in raw_orgs
        if o.get("name", "").strip()
    ]
    count = get_repo().populate_organizations(orgs, append_only=append_only)
    logger.info(f"Populated {count} organizations (append_only={append_only})")
    return _ok({"written": count})


@app.route("/api/autocomplete/org-names", methods=["GET"])
@_handle
def api_autocomplete_org_names():
    """Returns org names from the Organizations sheet (for richer autocomplete)."""
    orgs = get_repo().get_organizations()
    names = sorted({o.name for o in orgs if o.name})
    abbrevs = sorted({o.abbreviation for o in orgs if o.abbreviation})
    return _ok({"names": names, "abbreviations": abbrevs, "all": sorted(set(names + abbrevs))})


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

import data.jobs_store as jobs_store


@app.route("/api/jobs", methods=["GET"])
@_handle
def api_list_jobs():
    active_only = request.args.get("active_only", "0") == "1"
    return _ok(jobs_store.get_jobs(active_only=active_only))


@app.route("/api/jobs/<job_id>", methods=["GET"])
@_handle
def api_get_job(job_id: str):
    job = jobs_store.get_job(job_id)
    if job is None:
        return _err(f"Job '{job_id}' not found", 404)
    return _ok(job)


@app.route("/api/jobs", methods=["POST"])
@_handle
def api_create_job():
    body = request.get_json(force=True)
    job = jobs_store.add_job(
        title=body.get("title", "Untitled Position"),
        org=body.get("org", ""),
        org_id=body.get("org_id"),
        contact_name=body.get("contact_name", ""),
        contact_email=body.get("contact_email", ""),
        contact_phone=body.get("contact_phone", ""),
        contact_row_index=body.get("contact_row_index"),
        description=body.get("description", ""),
        pay=body.get("pay", ""),
        job_type=body.get("job_type", "full-time"),
        availability=body.get("availability", "open"),
        close_date=body.get("close_date", ""),
        location=body.get("location", ""),
        icon_url=body.get("icon_url", ""),
        flier_urls=body.get("flier_urls", []),
        tags=body.get("tags", []),
    )
    return _ok(job)


@app.route("/api/jobs/<job_id>", methods=["PUT", "PATCH"])
@_handle
def api_update_job(job_id: str):
    updates = request.get_json(force=True)
    job = jobs_store.update_job(job_id, updates)
    if job is None:
        return _err(f"Job '{job_id}' not found", 404)
    return _ok(job)


@app.route("/api/jobs/<job_id>", methods=["DELETE"])
@_handle
def api_delete_job(job_id: str):
    deleted = jobs_store.delete_job(job_id)
    if deleted is None:
        return _err(f"Job '{job_id}' not found", 404)
    return _ok({"deleted": job_id})


@app.route("/api/jobs/<job_id>/translate", methods=["POST"])
@_handle
def api_translate_job(job_id: str):
    """Auto-translate a job's title and description into the target language."""
    from services.newsletter_service import _get_translator, _translate_dict
    body    = request.get_json(force=True)
    to_lang = body.get("to_lang", "es")
    job     = jobs_store.get_job(job_id)
    if job is None:
        return _err(f"Job '{job_id}' not found", 404)
    translator = _get_translator(to_lang)
    if not translator:
        return _err("No translator configured for that language", 400)
    translatable = {
        "title":       job.get("title", ""),
        "description": job.get("description", ""),
        # pay, contact info, location — usually don't need translation
    }
    _translate_dict(translatable, translator, to_lang)
    translations = dict(job.get("translations") or {})
    translations[to_lang] = translatable
    updated = jobs_store.update_job(job_id, {"translations": translations})
    return _ok(updated)


@app.route("/api/jobs/tags", methods=["GET"])
@_handle
def api_job_tags():
    return _ok(jobs_store.get_all_job_tags())


@app.route("/api/images/<image_id>/link-job", methods=["POST"])
@_handle
def api_link_image_to_job(image_id: str):
    body   = request.get_json(force=True)
    job_id = body.get("job_id")
    if not job_id:
        return _err("job_id required", 400)
    updated = image_store.update_image(image_id, add_job_id=str(job_id))
    if updated is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok(updated)


@app.route("/api/images/<image_id>/link-job", methods=["DELETE"])
@_handle
def api_unlink_image_from_job(image_id: str):
    body   = request.get_json(force=True) or {}
    job_id = body.get("job_id")
    if not job_id:
        return _err("job_id required", 400)
    updated = image_store.update_image(image_id, remove_job_id=str(job_id))
    if updated is None:
        return _err(f"Image '{image_id}' not found", 404)
    return _ok(updated)


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Token auth middleware — only enforced for external (non-localhost) requests
# ---------------------------------------------------------------------------

_NO_AUTH_PREFIXES = ("/static/", "/api/server/")   # never token-gated

@app.before_request
def _check_token():
    """If the tunnel is on and token protection is enabled, require the token
    for non-localhost API calls.  The local browser is always exempt."""
    if request.remote_addr in ("127.0.0.1", "::1", "localhost"):
        return   # local browser — always allowed

    # Skip static files and server-management routes themselves
    for prefix in _NO_AUTH_PREFIXES:
        if request.path.startswith(prefix):
            return

    cfg = server_store.get_config()
    if not cfg.get("token_enabled"):
        return

    status = tunnel_svc.get_status()
    if status["status"] != "on":
        return   # tunnel is off — no enforcement needed

    token = (
        request.headers.get("X-Hormiga-Token")
        or request.args.get("token")
        or request.json.get("token") if request.is_json else None
    )
    if not server_store.validate_token(token or ""):
        return jsonify({"ok": False, "error": "Invalid or missing access token"}), 401


@app.after_request
def _track_connection(response):
    """Record non-localhost API requests and add CORS headers for mobile clients."""
    # CORS — allow the Flutter app (and any other client) to read API responses
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Hormiga-Token"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"

    if request.remote_addr not in ("127.0.0.1", "::1", "localhost"):
        if request.path.startswith("/api/"):
            tunnel_svc.record_connection(
                ip=request.remote_addr,
                method=request.method,
                path=request.path,
                user_agent=request.headers.get("User-Agent", ""),
                status_code=response.status_code,
            )
    return response


# ---------------------------------------------------------------------------
# Developer tools (only useful when developer_mode is enabled in settings)
# ---------------------------------------------------------------------------

@app.route("/api/dev/logs", methods=["GET"])
@_handle
def api_dev_logs():
    from core.logger import get_memory_handler
    limit = request.args.get("limit", 200, type=int)
    records = get_memory_handler().get_records()
    return _ok(records[-limit:] if limit else records)


@app.route("/api/dev/logs/clear", methods=["POST"])
@_handle
def api_dev_logs_clear():
    from core.logger import get_memory_handler
    get_memory_handler().clear()
    return _ok({"cleared": True})


@app.route("/api/<path:_>", methods=["OPTIONS"])
def _cors_preflight(_):
    """Handle CORS preflight requests from mobile clients."""
    return "", 204


# ---------------------------------------------------------------------------
# Server / Tunnel API
# ---------------------------------------------------------------------------

@app.route("/api/server/status", methods=["GET"])
@_handle
def api_server_status():
    status = tunnel_svc.get_status()
    cfg    = server_store.get_config()
    installed = tunnel_svc.cloudflared_installed()
    return _ok({
        **status,
        "server_name":   cfg["server_name"],
        "token_enabled": cfg["token_enabled"],
        "auto_start":    cfg["auto_start"],
        "port":          cfg["port"],
        "installed":     installed,
        "binary_path":   tunnel_svc.cloudflared_path(),
    })


@app.route("/api/server/start", methods=["POST"])
@_handle
def api_server_start():
    import socket as _socket
    cfg = server_store.get_config()
    if cfg.get("auto_port", True):
        # Use the port Flask is actually listening on (from settings, default 5000)
        from core.settings import get_settings as _get_settings
        port = _get_settings().get("port", 5000)
    else:
        port = cfg.get("port", 5000)
    result = tunnel_svc.start(port=port)
    if not result["ok"]:
        raise AppError(result["error"])
    return _ok({"message": "Tunnel starting…", "port": port})


@app.route("/api/server/stop", methods=["POST"])
@_handle
def api_server_stop():
    result = tunnel_svc.stop()
    if not result["ok"]:
        raise AppError(result["error"])
    return _ok({"message": "Tunnel stopped"})


@app.route("/api/server/logs", methods=["GET"])
@_handle
def api_server_logs():
    since = int(request.args.get("since", 0))
    return _ok({"logs": tunnel_svc.get_logs(since)})


@app.route("/api/server/logs/stream")
def api_server_logs_stream():
    """SSE endpoint — streams new log lines as they arrive."""
    import time as _time
    from flask import Response, stream_with_context

    def generate():
        idx       = 0
        tick      = 0
        while True:
            logs = tunnel_svc.get_logs(idx)
            for entry in logs:
                yield f"event: log\ndata: {json.dumps(entry)}\n\n"
            idx  += len(logs)
            tick += 1
            # Send a keep-alive ping every ~5 s so the connection doesn't drop
            if tick % 13 == 0:
                yield "event: ping\ndata: {}\n\n"
            _time.sleep(0.4)

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/server/connections", methods=["GET"])
@_handle
def api_server_connections():
    return _ok(tunnel_svc.get_connections())


@app.route("/api/server/config", methods=["GET"])
@_handle
def api_server_config_get():
    cfg = server_store.get_config()
    return _ok({
        "server_name":   cfg["server_name"],
        "token_enabled": cfg["token_enabled"],
        "auto_start":    cfg["auto_start"],
        "port":          cfg["port"],
        "auto_port":     cfg.get("auto_port", True),
        "access_token":  cfg["access_token"],
    })


@app.route("/api/server/config", methods=["PUT"])
@_handle
def api_server_config_put():
    data = request.json or {}
    cfg  = server_store.update_config(data)
    return _ok({
        "server_name":   cfg["server_name"],
        "token_enabled": cfg["token_enabled"],
        "auto_start":    cfg["auto_start"],
        "port":          cfg["port"],
        "auto_port":     cfg.get("auto_port", True),
        "access_token":  cfg["access_token"],
    })


@app.route("/api/server/token/regenerate", methods=["POST"])
@_handle
def api_server_token_regen():
    new_token = server_store.regenerate_token()
    return _ok({"access_token": new_token})


@app.route("/api/server/qr", methods=["GET"])
@_handle
def api_server_qr():
    """Generate a QR code PNG data URL for the tunnel URL."""
    import io, base64, qrcode

    status = tunnel_svc.get_status()
    url    = status.get("url")
    if not url:
        raise AppError("Tunnel is not running")

    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    return _ok({"qr_data_url": qr_data_url, "url": url})


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    settings = get_settings()

    # Resolve port — priority order:
    # 1. hormiga-runtime.json at well-known OS path (no env var needed)
    # 2. HORMIGA_PORT env var (backup for dev / non-Windows)
    # 3. settings.json → 5000 (plain dev fallback)
    def _electron_port() -> int | None:
        # Build candidate paths using OS-level env vars (always set by Windows/macOS/Linux)
        # so we don't depend on custom vars that PyInstaller may not forward.
        candidates = []
        if sys.platform == "win32":
            appdata = os.environ.get("APPDATA")
            if appdata:
                candidates.append(os.path.join(appdata, "Hormiga", "hormiga-runtime.json"))
        elif sys.platform == "darwin":
            home = os.path.expanduser("~")
            candidates.append(os.path.join(home, "Library", "Application Support", "Hormiga", "hormiga-runtime.json"))
        else:
            cfg = os.environ.get("XDG_CONFIG_HOME", os.path.join(os.path.expanduser("~"), ".config"))
            candidates.append(os.path.join(cfg, "Hormiga", "hormiga-runtime.json"))

        for p in candidates:
            try:
                with open(p, encoding="utf-8") as f:
                    v = int(json.load(f).get("port", 0))
                    if v:
                        logger.info(f"Port from runtime file: {v} ({p})")
                        return v
            except Exception:
                pass
        return None

    port = (
        _electron_port()
        or int(os.environ.get("HORMIGA_PORT", 0))
        or settings.get("port", 5000)
    )

    # When spawned by Electron skip opening a browser — Electron manages the window.
    if not _FROZEN and os.environ.get("HORMIGA_DATA_DIR") is None:
        def open_browser():
            webbrowser.open(f"http://localhost:{port}")
        Timer(1.2, open_browser).start()

    logger.info(f"Starting Hormiga on http://localhost:{port}")
    app.run(debug=not _FROZEN, port=port, use_reloader=False)
