"""SQLAlchemy engine and session factory.

The database URL is read from settings.json → database.url.
Defaults to the local Docker PostgreSQL instance used for development.

When moving to a real cloud database (Supabase, Neon, Railway, etc.),
update settings.json with the cloud connection URL. Nothing else changes.
"""
import time
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

logger = logging.getLogger(__name__)

_DEFAULT_URL = "postgresql://hormiga:hormiga_dev@localhost:5432/hormiga"


def _get_url() -> str:
    try:
        from core.settings import get_settings
        settings = get_settings()
        return settings.get("database", {}).get("url", _DEFAULT_URL)
    except Exception:
        return _DEFAULT_URL


# Module-level engine — created once on first import.
engine = create_engine(
    _get_url(),
    pool_pre_ping=True,   # reconnect automatically if connection is dropped
    pool_size=3,          # conservative — cloud DB has connection limits
    max_overflow=7,
    pool_timeout=30,
    connect_args={"connect_timeout": 15},
    echo=False,           # set True to log all SQL (useful for debugging)
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def wait_for_db(retries: int = 10, delay: float = 3.0) -> None:
    """Block until the database is reachable, retrying with a fixed delay.

    Supabase free-tier projects pause after inactivity and take several
    seconds to wake up.  This function retries until the first query
    succeeds, so the rest of startup doesn't need to handle connection errors.
    Raises RuntimeError if all attempts fail.
    """
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database ready (attempt %d)", attempt)
            return
        except Exception as e:
            last_err = e
            logger.warning(
                "Database not ready (attempt %d/%d): %s — retrying in %.0fs",
                attempt, retries, e, delay,
            )
            time.sleep(delay)
    raise RuntimeError(
        f"Could not connect to database after {retries} attempts: {last_err}"
    )


def init_db() -> None:
    """Create any missing tables and apply additive column migrations.

    Safe to call on every startup — all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
    """
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS json_store (
                key        TEXT PRIMARY KEY,
                data       JSONB        NOT NULL,
                updated_at TIMESTAMP    DEFAULT NOW()
            )
        """))
        # Additive column migrations — idempotent, safe to run on every startup
        conn.execute(text(
            "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS internal_notes TEXT DEFAULT ''"
        ))
    logger.info("init_db: schema verified/migrated")


def reset_sequences() -> None:
    """Advance each table's PK sequence to MAX(id) + 1.

    Required after bulk imports that used explicit IDs, which bypass the
    sequence counter.  Safe to call on every startup — it's a no-op when
    the sequence is already ahead of MAX(id).
    """
    tables = ["contacts", "events", "presenters", "organizations", "activity_log"]
    with engine.begin() as conn:
        for table in tables:
            conn.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE(MAX(id), 1)) FROM {table}"
            ))


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Context manager that yields a session and handles commit/rollback.

    Usage:
        with get_session() as s:
            s.add(row)
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
