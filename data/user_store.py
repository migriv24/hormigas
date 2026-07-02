"""Local user profile store.

Stored at data/user_profile.json — local-only, never synced to Sheets.
If the file doesn't exist (first run, or old install), returns safe defaults.
Migration-safe: new keys are merged in from defaults so old files still work.
"""
import json
import datetime
from pathlib import Path

_PROFILE_FILE = Path(__file__).parent / "user_profile.json"

_DEFAULTS: dict = {
    "display_name": "",
    "username": "",
    "email": "",
    "linked_contact_id": None,
}


def get_profile() -> dict:
    """Return the user profile, merging with defaults for any missing keys."""
    if not _PROFILE_FILE.exists():
        return dict(_DEFAULTS)
    try:
        data = json.loads(_PROFILE_FILE.read_text(encoding="utf-8"))
        # Forward-merge: new default keys appear in old files automatically
        return {**_DEFAULTS, **data}
    except Exception:
        return dict(_DEFAULTS)


def save_profile(updates: dict) -> dict:
    """Merge updates into the current profile and persist to disk."""
    current = get_profile()
    for key in _DEFAULTS:
        if key in updates:
            current[key] = updates[key]
    now = datetime.datetime.now().isoformat()
    current.setdefault("created_at", now)
    current["updated_at"] = now
    _PROFILE_FILE.write_text(
        json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return current
