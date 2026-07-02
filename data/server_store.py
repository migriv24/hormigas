"""data/server_store.py — Persists server/tunnel configuration.

Stored in data/server_config.json (gitignored — contains the access token).
"""
import json
import secrets
from pathlib import Path

_PATH = Path(__file__).parent / "server_config.json"

_DEFAULTS = {
    "server_name":    "Hormiga Server",
    "access_token":   "",   # generated on first save
    "token_enabled":  True,
    "auto_start":     False,
    "port":           5000,
    "auto_port":      True,   # use Flask's own port automatically
}


def _load() -> dict:
    if not _PATH.exists():
        return dict(_DEFAULTS)
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        return {**_DEFAULTS, **data}
    except Exception:
        return dict(_DEFAULTS)


def _save(data: dict) -> None:
    _PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_config() -> dict:
    cfg = _load()
    # Generate token on first access if missing
    if not cfg["access_token"]:
        cfg["access_token"] = secrets.token_urlsafe(20)
        _save(cfg)
    return cfg


def update_config(patch: dict) -> dict:
    cfg = _load()
    allowed = {"server_name", "token_enabled", "auto_start", "port", "auto_port"}
    for k, v in patch.items():
        if k in allowed:
            cfg[k] = v
    if not cfg.get("access_token"):
        cfg["access_token"] = secrets.token_urlsafe(20)
    _save(cfg)
    return cfg


def regenerate_token() -> str:
    cfg = _load()
    cfg["access_token"] = secrets.token_urlsafe(20)
    _save(cfg)
    return cfg["access_token"]


def validate_token(token: str) -> bool:
    """Constant-time comparison to avoid timing attacks."""
    import hmac
    cfg = _load()
    if not cfg.get("token_enabled"):
        return True
    stored = cfg.get("access_token", "")
    if not stored:
        return True
    return hmac.compare_digest(stored, token)
