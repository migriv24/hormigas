"""services/tunnel_service.py — Cloudflare Tunnel lifecycle manager.

Manages a `cloudflared tunnel --url http://localhost:PORT` subprocess.
Parses the assigned tunnel URL from its output, buffers logs, and
tracks recent inbound API connections for the Server tab UI.

State is in-process (not persisted) — the tunnel stops when Flask stops.
"""
import collections
import json
import os
import re
import secrets
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────────────

_CLOUDFLARED_NAMES = ["cloudflared", "cloudflared.exe"]
_LOG_MAXLEN = 300        # rolling log buffer size
_CONN_MAXLEN = 50        # recent connections to track

# ── Shared state (module-level, thread-safe via locks) ────────────────────────

_lock        = threading.Lock()
_process     = None          # subprocess.Popen
_tunnel_url  = None          # e.g. "https://abc.trycloudflare.com"
_status      = "off"         # "off" | "starting" | "on" | "error"
_error_msg   = ""
_log_buffer  = collections.deque(maxlen=_LOG_MAXLEN)
_connections = collections.deque(maxlen=_CONN_MAXLEN)
_start_time  = None


# ── Cloudflared binary discovery ──────────────────────────────────────────────

def _find_cloudflared() -> str | None:
    """Return path to cloudflared binary, or None if not found."""
    import shutil
    for name in _CLOUDFLARED_NAMES:
        path = shutil.which(name)
        if path:
            return path
    # Also check next to this script (for manual installs)
    local = Path(__file__).parent.parent / "cloudflared.exe"
    if local.exists():
        return str(local)
    return None


def cloudflared_installed() -> bool:
    return _find_cloudflared() is not None


def cloudflared_path() -> str | None:
    return _find_cloudflared()


# ── Tunnel lifecycle ──────────────────────────────────────────────────────────

def _reader_thread(proc: subprocess.Popen) -> None:
    """Background thread: reads cloudflared output, extracts URL, buffers logs."""
    global _tunnel_url, _status, _error_msg

    url_pattern  = re.compile(r'https://[^\s|<>"]+\.trycloudflare\.com')
    ansi_pattern = re.compile(r'\x1b\[[0-9;]*[mGKHF]')

    while True:
        raw_line = proc.stdout.readline()
        if not raw_line:          # EOF — process ended
            break
        line = raw_line.strip()
        if not line:
            continue

        # Strip ANSI escape codes before regex matching (cloudflared uses colour
        # output on Windows which can be interspersed inside the URL string).
        clean = ansi_pattern.sub('', line)

        with _lock:
            _log_buffer.append({
                "ts":   datetime.now().strftime("%H:%M:%S"),
                "line": clean,
            })

            if _tunnel_url is None:
                m = url_pattern.search(clean)
                if m:
                    _tunnel_url = m.group(0).rstrip('/')
                    _status     = "on"

            if _status == "starting" and any(
                kw in line.lower() for kw in ("error", "failed", "unable")
            ):
                _error_msg = line
                _status    = "error"

    # Process ended
    with _lock:
        if _status not in ("off", "error"):
            _status = "off"
        _log_buffer.append({
            "ts":   datetime.now().strftime("%H:%M:%S"),
            "line": "[cloudflared process ended]",
        })


def start(port: int = 5000) -> dict:
    global _process, _tunnel_url, _status, _error_msg, _start_time

    with _lock:
        if _status in ("on", "starting"):
            return {"ok": False, "error": "Tunnel already running"}

        binary = _find_cloudflared()
        if not binary:
            return {"ok": False, "error": "cloudflared not installed"}

        _tunnel_url = None
        _status     = "starting"
        _error_msg  = ""
        _start_time = datetime.now().isoformat()
        _log_buffer.append({
            "ts": datetime.now().strftime("%H:%M:%S"),
            "line": f"[Starting cloudflared on port {port}…]",
        })

    try:
        proc = subprocess.Popen(
            [binary, "tunnel", "--url", f"http://localhost:{port}",
             "--no-autoupdate"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,          # line-buffered (correct for text mode)
        )
        with _lock:
            _process = proc

        t = threading.Thread(target=_reader_thread, args=(proc,), daemon=True)
        t.start()
        return {"ok": True}
    except Exception as e:
        with _lock:
            _status    = "error"
            _error_msg = str(e)
        return {"ok": False, "error": str(e)}


def stop() -> dict:
    global _process, _tunnel_url, _status, _start_time

    with _lock:
        if _status == "off":
            return {"ok": False, "error": "Tunnel is not running"}
        proc = _process

    if proc:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    with _lock:
        _process    = None
        _tunnel_url = None
        _status     = "off"
        _start_time = None
        _log_buffer.append({
            "ts":   datetime.now().strftime("%H:%M:%S"),
            "line": "[Tunnel stopped by user]",
        })

    return {"ok": True}


# ── Status / logs ─────────────────────────────────────────────────────────────

def get_status() -> dict:
    with _lock:
        return {
            "status":     _status,
            "url":        _tunnel_url,
            "error":      _error_msg,
            "start_time": _start_time,
            "log_count":  len(_log_buffer),
            "conn_count": len(_connections),
        }


def get_logs(since_index: int = 0) -> list[dict]:
    with _lock:
        logs = list(_log_buffer)
    return logs[since_index:]


def get_connections() -> list[dict]:
    with _lock:
        return list(_connections)


# ── Connection tracking (called by Flask middleware) ──────────────────────────

def record_connection(ip: str, method: str, path: str,
                      user_agent: str, status_code: int) -> None:
    """Called after each request to track recent external connections."""
    with _lock:
        if _status != "on":
            return
        _connections.appendleft({
            "ts":         datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "ip":         ip,
            "method":     method,
            "path":       path,
            "device":     _parse_device(user_agent),
            "user_agent": user_agent[:120],
            "status":     status_code,
        })


def _parse_device(ua: str) -> str:
    ua = ua.lower()
    if "android" in ua:
        return "Android"
    if "iphone" in ua or "ipad" in ua:
        return "iOS"
    if "flutter" in ua:
        return "Flutter app"
    if "windows" in ua:
        return "Windows"
    if "mac" in ua:
        return "Mac"
    if "linux" in ua:
        return "Linux"
    return "Unknown"
