"""File-based local storage for presets, projects, and templates.

These are local-only (not synced to Sheets) — they are app-state files.
  data/presets.json        — saved section presets
  data/projects/<name>.json — saved newsletter projects
  data/templates/<name>.json — built-in or user templates
"""
import json
import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from core.version import SCHEMA_VERSIONS

_PROJECT_SCHEMA_VERSION = SCHEMA_VERSIONS["project"]

_BASE = Path(__file__).parent
_PRESETS_FILE = _BASE / "presets.json"
_PROJECTS_DIR = _BASE / "projects"
_TEMPLATES_DIR = _BASE / "templates"

_PROJECTS_DIR.mkdir(exist_ok=True)
_TEMPLATES_DIR.mkdir(exist_ok=True)


def _slugify(name: str) -> str:
    return re.sub(r"[^\w\-]", "-", name.strip().lower())


# ── Presets ───────────────────────────────────────────────────────────────────

def get_presets() -> list[dict]:
    if not _PRESETS_FILE.exists():
        return []
    return json.loads(_PRESETS_FILE.read_text(encoding="utf-8"))


def save_preset(name: str, section_type: str, data: dict) -> dict:
    import uuid, datetime
    presets = get_presets()
    preset = {
        "id": uuid.uuid4().hex[:10],
        "name": name,
        "section_type": section_type,
        "data": data,
        "created_at": datetime.datetime.now().isoformat(),
    }
    presets.append(preset)
    _PRESETS_FILE.write_text(json.dumps(presets, ensure_ascii=False, indent=2), encoding="utf-8")
    return preset


def delete_preset(preset_id: str) -> bool:
    presets = get_presets()
    new = [p for p in presets if p["id"] != preset_id]
    if len(new) == len(presets):
        return False
    _PRESETS_FILE.write_text(json.dumps(new, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


# ── Projects ──────────────────────────────────────────────────────────────────

def list_projects() -> list[dict]:
    projects = []
    for f in sorted(_PROJECTS_DIR.glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
            # Support both new dual-canvas format (sections_en) and legacy (sections)
            section_count = len(doc.get("sections_en") or doc.get("sections", []))
            projects.append({
                "filename": f.stem,
                "month": doc.get("month", f.stem),
                "subtitle": doc.get("subtitle", ""),
                "section_count": section_count,
                "has_es_canvas": bool(doc.get("sections_es")),
                "modified": f.stat().st_mtime,
            })
        except Exception:
            pass
    return sorted(projects, key=lambda p: p["modified"], reverse=True)


def load_project(filename: str) -> dict | None:
    path = _PROJECTS_DIR / f"{_slugify(filename)}.json"
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    # Strip internal versioning key before handing to caller
    doc.pop("_schema_version", None)
    return doc


def save_project(filename: str, doc: dict) -> str:
    slug = _slugify(filename)
    path = _PROJECTS_DIR / f"{slug}.json"
    versioned = {"_schema_version": _PROJECT_SCHEMA_VERSION, **doc}
    path.write_text(json.dumps(versioned, ensure_ascii=False, indent=2), encoding="utf-8")
    return slug


def delete_project(filename: str) -> bool:
    path = _PROJECTS_DIR / f"{_slugify(filename)}.json"
    if not path.exists():
        return False
    path.unlink()
    return True


# ── Templates ─────────────────────────────────────────────────────────────────

def list_templates() -> list[dict]:
    templates = []
    for f in sorted(_TEMPLATES_DIR.glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
            templates.append({
                "filename": f.stem,
                "name": doc.get("_template_name", f.stem),
                "description": doc.get("_template_description", ""),
                "section_count": len(doc.get("sections", [])),
            })
        except Exception:
            pass
    return templates


def load_template(filename: str) -> dict | None:
    path = _TEMPLATES_DIR / f"{_slugify(filename)}.json"
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    # Strip template metadata before returning as a project doc
    doc.pop("_template_name", None)
    doc.pop("_template_description", None)
    return doc
