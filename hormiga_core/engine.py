"""
engine — the one Void Core manager Hormiga runs on.

Owns: the C engine handle (via the voidcore Python binding), the Dispatcher
seam (adds scry/temper/materialize/reduce), glyph registration, the holiday
registry + effect handler, state persistence, and the logging bridge onto
Hormiga's own logger (SPEC §9: bind, don't duplicate).

The state document lives in data/void_state.json (gitignored — it is working
data, not source). Every dispatch persists the exported state, so a crash
never loses more than the in-flight command; the `save` verb additionally
routes through the effect handler as the official Save Progress.

Thread-safety: Flask serves requests on worker threads; the C core is one
manager instance, so dispatch is serialized behind a lock.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from core.logger import get_logger

logger = get_logger("voidcore")

_BASE_DIR = Path(__file__).resolve().parent.parent


def _state_file() -> Path:
    """Where the state document persists. Packaged app: the Electron-managed
    data dir (HORMIGA_DATA_DIR) — never _MEIPASS, which is wiped per run.
    Dev checkout: data/void_state.json (gitignored)."""
    data_dir = os.environ.get("HORMIGA_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "void_state.json"
    return _BASE_DIR / "data" / "void_state.json"


STATE_FILE = _state_file()

DEFAULT_MANTLE = "newsletter"


def _import_voidcore():
    """Import the voidcore package: the editable dev install if present,
    else the runtime vendored into the app bundle (vendor/voidcore — see
    scripts/vendor_voidcore.py). In a frozen build the bundle root is
    sys._MEIPASS; in a checkout it is the repo root."""
    try:
        import voidcore
        return voidcore
    except ImportError:
        bundle_root = Path(getattr(sys, "_MEIPASS", _BASE_DIR))
        vendor = bundle_root / "vendor" / "voidcore"
        if vendor.is_dir():
            sys.path.insert(0, str(vendor))
            import voidcore
            logger.info(f"voidcore loaded from vendored runtime: {vendor}")
            return voidcore
        raise


class HormigaEngine:
    def __init__(self, get_repo: Callable[[], Any]):
        self.available = False
        self.error: Optional[str] = None
        self._lock = threading.Lock()
        try:
            voidcore = _import_voidcore()
            from . import glyphs
            from .effects import make_effect_handler
            from .holidays import build_registry

            state = self._load_state()
            self.vc = voidcore.VoidCore(state=state)
            self.version = self.vc.version
            n = glyphs.register_all(self.vc)
            # Filter holiday entities through Void Core's own tag_match FFI (0.2.0),
            # so `effect query events "x"` == `ls --tag x` — one grammar, no host copy.
            self.holidays = build_registry(get_repo, self.vc.tag_match)
            self.vc.set_effect_handler(
                make_effect_handler(self.holidays, self._persist_state, logger))
            self.dispatcher = voidcore.Dispatcher(self.vc)
            self._ensure_default_mantle(fresh=state is None)
            self.available = True
            logger.info(f"Void Core {self.version} up — {n} glyphs, "
                        f"{len(self.holidays)} holidays, state={STATE_FILE.name}")
        except Exception as exc:
            self.error = str(exc)
            logger.error(f"Void Core engine unavailable: {exc}")

    # ── state persistence ─────────────────────────────────────────────────────

    def _load_state(self) -> Optional[dict]:
        try:
            if STATE_FILE.exists():
                return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error(f"void_state.json unreadable ({exc}) — starting empty")
        return None

    def _persist_state(self, state: Optional[dict] = None) -> None:
        doc = state if state is not None else self.vc.export_state()
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(doc, indent=1), encoding="utf-8")

    def _ensure_default_mantle(self, fresh: bool) -> None:
        state = self.vc.export_state()
        names = [m.get("name") for m in state.get("mantles", [])]
        if DEFAULT_MANTLE not in names:
            self.vc.dispatch(f"mantle new {DEFAULT_MANTLE}")
        elif not (state.get("active") or {}).get("mantle"):
            self.vc.dispatch(f"use {DEFAULT_MANTLE}")

    # ── the one entry point ───────────────────────────────────────────────────

    def dispatch(self, command: str) -> dict:
        """Run one dispatcher command; returns the SPEC §6 {ok, lines, data}."""
        if not self.available:
            lines = [
                "The Void Core engine could not be loaded on this platform/build.",
                f"Reason: {self.error or 'unknown'}",
            ]
            if not getattr(sys, "frozen", False):
                lines.append("Dev checkout fix: pip install -e ../VoidCore "
                             "(or run scripts/vendor_voidcore.py)")
            return {"ok": False, "data": None, "lines": lines}
        with self._lock:
            result = self.dispatcher.dispatch(command)
            try:
                self._persist_state()
            except Exception as exc:
                logger.error(f"state persist failed: {exc}")
            level = "info" if result.get("ok") else "warning"
            getattr(logger, level)(f"dispatch: {command!r} -> ok={result.get('ok')}")
            return result


_engine: Optional[HormigaEngine] = None
_engine_lock = threading.Lock()


def get_engine(get_repo: Optional[Callable[[], Any]] = None) -> HormigaEngine:
    """Singleton accessor. The first caller must supply `get_repo` (app.py's
    lazy repository accessor); later callers just get the engine."""
    global _engine
    with _engine_lock:
        if _engine is None:
            if get_repo is None:
                raise RuntimeError("engine not initialized — pass get_repo on first call")
            _engine = HormigaEngine(get_repo)
        return _engine
