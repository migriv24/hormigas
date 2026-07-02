"""Local job listing store.

Persists job/hiring opportunity records to data/jobs.json.

Schema (each record):
  id              str   — stable 12-char hex UUID
  title           str   — EN job title
  org             str   — display org name
  org_id          str?  — link to org in orgs system (null if not linked)
  contact_name    str   — primary contact name
  contact_email   str
  contact_phone   str
  contact_row_index int? — link to contacts system (null if not linked)
  description     str   — EN description / requirements
  pay             str   — "$24–27/hr" | "Volunteer" | ""
  job_type        str   — "full-time" | "part-time" | "temporary" | "volunteer" | "contract"
  availability    str   — "open" | "closing-soon" | "closed"
  close_date      str   — "April 20, 2026" or ""
  location        str   — "Eugene, OR" | "Remote" | "Hybrid" | ""
  icon_url        str   — emoji or image URL for the card icon
  flier_urls      list  — ImgBB URLs of attached fliers
  tags            list  — free-form string tags (e.g. ["hiring", "bilingual"])
  active          bool  — false = archived / no longer shown
  translations    dict  — {"es": {"title": "...", "description": "..."}}
  created_at      str   — ISO timestamp
  updated_at      str?  — ISO timestamp of last update
"""
import datetime
import json
import uuid
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from core.version import SCHEMA_VERSIONS
from data.db.cloud_store import cloud_load, cloud_save, is_cloud_available

_STORE_FILE = Path(__file__).parent / "jobs.json"
_JOBS_SCHEMA_VERSION = SCHEMA_VERSIONS["jobs"]
_CLOUD_KEY = "jobs"

_DEFAULTS = {
    "org":                "",
    "org_id":             None,
    "contact_name":       "",
    "contact_email":      "",
    "contact_phone":      "",
    "contact_row_index":  None,
    "description":        "",
    "pay":                "",
    "job_type":           "full-time",
    "availability":       "open",
    "close_date":         "",
    "location":           "",
    "icon_url":           "",
    "flier_urls":         [],
    "tags":               [],
    "active":             True,
    "translations":       {},
    "updated_at":         None,
}


def _normalize(job: dict) -> dict:
    for k, v in _DEFAULTS.items():
        if k in ("flier_urls", "tags"):
            job.setdefault(k, [])
            if not isinstance(job[k], list):
                job[k] = []
        elif k == "translations":
            job.setdefault(k, {})
            if not isinstance(job[k], dict):
                job[k] = {}
        else:
            job.setdefault(k, v)
    return job


def _load() -> list[dict]:
    if is_cloud_available():
        raw = cloud_load(_CLOUD_KEY) or {}
    elif _STORE_FILE.exists():
        try:
            raw = json.loads(_STORE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    else:
        return []
    jobs = raw.get("jobs", raw) if isinstance(raw, dict) else raw
    return [_normalize(j) for j in jobs]


def _save(jobs: list[dict]) -> None:
    envelope = {"_schema_version": _JOBS_SCHEMA_VERSION, "jobs": jobs}
    if is_cloud_available():
        cloud_save(_CLOUD_KEY, envelope)
        return
    _STORE_FILE.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

def get_jobs(active_only: bool = False) -> list[dict]:
    jobs = _load()
    if active_only:
        jobs = [j for j in jobs if j.get("active", True)]
    return jobs


def get_job(job_id: str) -> dict | None:
    return next((j for j in _load() if j["id"] == job_id), None)


def add_job(
    title: str,
    org: str = "",
    org_id: str = None,
    contact_name: str = "",
    contact_email: str = "",
    contact_phone: str = "",
    contact_row_index: int = None,
    description: str = "",
    pay: str = "",
    job_type: str = "full-time",
    availability: str = "open",
    close_date: str = "",
    location: str = "",
    icon_url: str = "",
    flier_urls: list = None,
    tags: list = None,
) -> dict:
    jobs = _load()
    now = datetime.datetime.now().isoformat()
    record = {
        "id":                 uuid.uuid4().hex[:12],
        "title":              title,
        "org":                org,
        "org_id":             org_id,
        "contact_name":       contact_name,
        "contact_email":      contact_email,
        "contact_phone":      contact_phone,
        "contact_row_index":  contact_row_index,
        "description":        description,
        "pay":                pay,
        "job_type":           job_type,
        "availability":       availability,
        "close_date":         close_date,
        "location":           location,
        "icon_url":           icon_url,
        "flier_urls":         flier_urls if isinstance(flier_urls, list) else [],
        "tags":               tags if isinstance(tags, list) else [],
        "active":             True,
        "translations":       {},
        "created_at":         now,
        "updated_at":         None,
    }
    jobs.insert(0, record)
    _save(jobs)
    return record


def update_job(job_id: str, updates: dict) -> dict | None:
    """Apply a partial update dict to the job. Returns updated record or None."""
    jobs = _load()
    for job in jobs:
        if job["id"] == job_id:
            allowed = {
                "title", "org", "org_id", "contact_name", "contact_email",
                "contact_phone", "contact_row_index", "description", "pay",
                "job_type", "availability", "close_date", "location",
                "icon_url", "flier_urls", "tags", "active", "translations",
            }
            for k, v in updates.items():
                if k in allowed:
                    job[k] = v
            job["updated_at"] = datetime.datetime.now().isoformat()
            _save(jobs)
            return job
    return None


def delete_job(job_id: str) -> dict | None:
    jobs = _load()
    target = next((j for j in jobs if j["id"] == job_id), None)
    if target is None:
        return None
    _save([j for j in jobs if j["id"] != job_id])
    return target


def get_all_job_tags() -> list[str]:
    tags: set[str] = set()
    for job in _load():
        for t in job.get("tags") or []:
            if t:
                tags.add(t)
    return sorted(tags)
