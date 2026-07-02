import collections
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_COLORS = {
    "DEBUG":    "\033[36m",   # Cyan
    "INFO":     "\033[32m",   # Green
    "WARNING":  "\033[33m",   # Yellow
    "ERROR":    "\033[31m",   # Red
    "CRITICAL": "\033[35m",   # Magenta
}
_RESET = "\033[0m"


class _MemoryHandler(logging.Handler):
    """Keeps the last N log records in memory for the Developer tab."""

    def __init__(self, capacity: int = 500):
        super().__init__()
        self._buf: collections.deque = collections.deque(maxlen=capacity)
        self.setFormatter(logging.Formatter(
            fmt="%(asctime)s",
            datefmt="%H:%M:%S",
        ))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._buf.append({
                "ts":    self.formatTime(record, "%H:%M:%S"),
                "level": record.levelname,
                "name":  record.name,
                "msg":   record.getMessage(),
            })
        except Exception:
            pass

    def get_records(self) -> list[dict]:
        return list(self._buf)

    def clear(self) -> None:
        self._buf.clear()


# Singleton shared across all loggers
_memory_handler = _MemoryHandler(capacity=500)


def get_memory_handler() -> _MemoryHandler:
    return _memory_handler


class _ColorFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        color = _COLORS.get(record.levelname, _RESET)
        record.levelname = f"{color}{record.levelname}{_RESET}"
        return super().format(record)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    # Resolve level lazily to avoid circular import with settings at module load
    try:
        from core.settings import get_settings
        level_name = get_settings().get("log_level", "INFO").upper()
    except Exception:
        level_name = "INFO"

    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(_ColorFormatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))

    file_handler = RotatingFileHandler(
        _LOG_DIR / "app.log",
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))

    logger.addHandler(console)
    logger.addHandler(file_handler)
    logger.addHandler(_memory_handler)
    logger.propagate = False
    return logger
