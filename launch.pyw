"""
launch.pyw — Desktop launcher for Newsletter Creator.
Runs via pythonw.exe (no console window).

- If server is already running  → just opens the browser tab.
- If not                        → starts Flask, then opens the browser.
- On any startup error          → writes to launch_error.log and shows a popup.
"""
import os
import sys
import json
import socket
import webbrowser
import traceback
from pathlib import Path
from threading import Timer

BASE = Path(__file__).resolve().parent
LOG  = BASE / "launch_error.log"

# ── Redirect stdout/stderr to a log file ─────────────────────────────────────
# pythonw has no console; Flask and libraries still write to stdout/stderr,
# which would crash silently without this redirect.
try:
    _log_fh = open(LOG, "w", encoding="utf-8", buffering=1)
    sys.stdout = _log_fh
    sys.stderr = _log_fh
except Exception:
    pass


def _fatal(msg: str):
    """Write error to log and show a Windows message-box, then exit."""
    try:
        LOG.write_text(msg, encoding="utf-8")
    except Exception:
        pass
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            f"Newsletter Creator failed to start.\n\n{msg}\n\nSee launch_error.log for details.",
            "Launch Error",
            0x10,  # MB_ICONERROR
        )
    except Exception:
        pass
    sys.exit(1)


try:
    os.chdir(BASE)
    sys.path.insert(0, str(BASE))

    # ── Read port ─────────────────────────────────────────────────────────────
    try:
        _cfg = json.loads((BASE / "settings.json").read_text(encoding="utf-8"))
        PORT = int(_cfg.get("port", 5000))
    except Exception:
        PORT = 5000

    URL = f"http://localhost:{PORT}"

    # ── Already running? ──────────────────────────────────────────────────────
    def _server_running() -> bool:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", PORT))
            s.close()
            return True
        except OSError:
            return False

    if _server_running():
        webbrowser.open(URL)
        sys.exit(0)

    # ── Start Flask ───────────────────────────────────────────────────────────
    from app import app  # noqa: E402

    Timer(1.5, lambda: webbrowser.open(URL)).start()
    app.run(debug=False, port=PORT, use_reloader=False)

except Exception:
    _fatal(traceback.format_exc())
