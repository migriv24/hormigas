"""Organizations detection and normalization service.

All detection / dedup logic runs in memory against cached contacts and events.
Nothing is written to the sheet until the caller explicitly calls a repo method.
This keeps "working/draft" state fully separate from "finalized" sheet state.
"""
import re
from collections import defaultdict

from core.logger import get_logger

logger = get_logger("orgs_service")

# ── Splitting ──────────────────────────────────────────────────────────────────

_SPLIT_RE = re.compile(
    r",|;|\s+&\s+|\s+and\s+|\s+/\s+|\n|\r",
    re.IGNORECASE,
)


def split_org_string(s: str) -> list[str]:
    """Split a raw org field that may contain multiple orgs."""
    if not s:
        return []
    parts = _SPLIT_RE.split(s)
    return [p.strip() for p in parts if p.strip()]


# ── Detection ─────────────────────────────────────────────────────────────────

def detect_organizations(contacts: list, events: list) -> list[dict]:
    """
    Extract unique organizations from contacts + events and return a
    draft list suitable for the wizard UI.

    Each entry: {
        name, count, sources: ['contacts'|'events'],
        suggested_contacts: [{name, email}],
        similar_to: [index_in_result_list],
    }
    """
    # bucket: normalized_name → {canonical_name, count, sources, people}
    buckets: dict[str, dict] = {}

    def _add(raw_name: str, source: str, person_name: str = "", person_email: str = ""):
        key = raw_name.lower()
        if key not in buckets:
            buckets[key] = {
                "name":    raw_name,
                "count":   0,
                "sources": [],
                "suggested_contacts": [],
            }
        b = buckets[key]
        b["count"] += 1
        if source not in b["sources"]:
            b["sources"].append(source)
        if person_name:
            person = {"name": person_name, "email": person_email}
            if person not in b["suggested_contacts"]:
                b["suggested_contacts"].append(person)

    for c in contacts:
        for org_name in split_org_string(c.organization or ""):
            _add(org_name, "contacts", c.name, c.email)

    for e in events:
        for org_name in split_org_string(e.organization or ""):
            _add(org_name, "events")

    # Sort: most-referenced first, then alpha
    orgs = sorted(buckets.values(), key=lambda x: (-x["count"], x["name"].lower()))

    # Flag potential duplicates
    orgs = _flag_similar(orgs)

    logger.info(f"Detected {len(orgs)} unique organizations")
    return orgs


# ── Similarity ────────────────────────────────────────────────────────────────

def _normalize_words(s: str) -> set[str]:
    _STOPWORDS = {"of", "the", "and", "for", "in", "at", "a", "an", "de", "la", "el", "los", "las"}
    words = re.findall(r"[a-z0-9]+", s.lower())
    return {w for w in words if w not in _STOPWORDS} or set(words)


def _initials_of(s: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", s)
    return "".join(w[0] for w in words).lower()


def _are_similar(a: str, b: str) -> bool:
    """Return True if a and b might be the same organization."""
    a_l, b_l = a.lower().strip(), b.lower().strip()
    if a_l == b_l:
        return False  # identical key → already same bucket

    # Acronym match: one is the initials of the other
    if len(a_l) <= 8 and a_l == _initials_of(b):
        return True
    if len(b_l) <= 8 and b_l == _initials_of(a):
        return True

    # One contains the other (e.g. "SASS" inside "SASS-Lane")
    if a_l in b_l or b_l in a_l:
        return True

    # Jaccard on meaningful words
    a_words = _normalize_words(a)
    b_words = _normalize_words(b)
    if a_words and b_words:
        jaccard = len(a_words & b_words) / len(a_words | b_words)
        if jaccard >= 0.5:
            return True

    return False


def _flag_similar(orgs: list[dict]) -> list[dict]:
    """Annotate each org with indices of potentially duplicate orgs."""
    for i, org in enumerate(orgs):
        org["similar_to"] = [
            j for j, other in enumerate(orgs)
            if i != j and _are_similar(org["name"], other["name"])
        ]
    return orgs


# ── Merge helpers (called by routes after user confirms) ─────────────────────

def merge_org_dicts(keeper: dict, absorbed: dict) -> dict:
    """
    Merge `absorbed` into `keeper`.  The keeper's name is kept as primary.
    The absorbed name becomes alternate_name (if not already set).
    """
    merged = dict(keeper)
    if not merged.get("alternate_name"):
        merged["alternate_name"] = absorbed.get("name", "")
    if not merged.get("abbreviation") and len(absorbed.get("name", "")) <= 8:
        merged["abbreviation"] = absorbed["name"]
    # Merge suggested_contacts
    seen = {c["name"] for c in merged.get("suggested_contacts", [])}
    for c in absorbed.get("suggested_contacts", []):
        if c["name"] not in seen:
            merged.setdefault("suggested_contacts", []).append(c)
            seen.add(c["name"])
    merged["count"] = merged.get("count", 0) + absorbed.get("count", 0)
    return merged
