import json
import os
from pathlib import Path
from core.exceptions import SettingsError


def _resolve_settings_path() -> Path:
    """Locate settings.json.

    Search order:
    1. $HORMIGA_DATA_DIR/settings.json  — set by Electron when packaged
    2. CWD/settings.json                — explicit working directory
    3. <project_root>/settings.json     — dev fallback (file next to app.py)
    """
    data_dir = os.environ.get("HORMIGA_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "settings.json"
    cwd_candidate = Path.cwd() / "settings.json"
    if cwd_candidate.exists():
        return cwd_candidate
    return Path(__file__).parent.parent / "settings.json"


_SETTINGS_PATH = _resolve_settings_path()
_cache: dict | None = None


def get_settings() -> dict:
    global _cache
    if _cache is None:
        _cache = _load()
    return _cache


def reload_settings() -> dict:
    global _cache
    _cache = None
    return get_settings()


def _load() -> dict:
    if not _SETTINGS_PATH.exists():
        raise SettingsError(f"settings.json not found at {_SETTINGS_PATH}")
    try:
        with open(_SETTINGS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise SettingsError(f"settings.json is invalid JSON: {e}")

    _validate(data)
    return data


def _validate(data: dict) -> None:
    required = ["google_credentials_path", "google_sheet_id", "imgbb_api_key"]
    missing = [k for k in required if k not in data]
    if missing:
        raise SettingsError(f"settings.json missing required keys: {missing}")


def get_database_url() -> str | None:
    """Return the configured PostgreSQL database URL, or None if not set."""
    try:
        return get_settings().get("database", {}).get("url") or None
    except Exception:
        return None


def get_supabase_url() -> str | None:
    """Return the Supabase project REST URL, or None if not configured."""
    try:
        return get_settings().get("supabase", {}).get("url") or None
    except Exception:
        return None


def get_supabase_anon_key() -> str | None:
    """Return the Supabase anon/publishable key, or None if not configured."""
    try:
        return get_settings().get("supabase", {}).get("anon_key") or None
    except Exception:
        return None


def is_supabase_configured() -> bool:
    """True when both supabase.url and supabase.anon_key are present."""
    return bool(get_supabase_url() and get_supabase_anon_key())
