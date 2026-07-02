"""Assembles newsletter HTML from a NewsletterDoc.

render_email(doc, skip_translation)  → full email-safe HTML string
render_section(section, lang)         → HTML snippet for builder preview
translate_sections(sections, to_lang) → translated section dicts (for dual-canvas)

Translation abstraction: _get_translator(lang) returns a TranslationService.
Swap provider in settings.json ("google" | future "claude") without changing callers.
"""
import os
from copy import deepcopy
from jinja2 import Environment, FileSystemLoader, select_autoescape

from core.exceptions import NewsletterError
from core.logger import get_logger
from core.settings import get_settings
from schemas.newsletter import NewsletterDoc, NewsletterSection
from services.translation.base import TranslationService

logger = get_logger("newsletter_service")

_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")


def _make_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(os.path.join(_TEMPLATES_DIR, "newsletter_sections")),
        autoescape=select_autoescape(["html", "jinja"]),
    )


def _get_translator(lang: str) -> TranslationService | None:
    if lang == "en":
        return None
    settings = get_settings()
    provider = settings.get("translation_provider", "google")
    if provider == "google":
        from services.translation.google_translate import GoogleTranslateService
        return GoogleTranslateService()
    # Future: elif provider == "claude": ...
    return None


def _translate_section(section: NewsletterSection, translator: TranslationService, lang: str) -> NewsletterSection:
    """Return a new section with all string values translated."""
    from copy import deepcopy
    s = deepcopy(section)
    _translate_dict(s.data, translator, lang)
    return s


_SKIP_TRANSLATE_KEYS = {
    # URLs and emails — must never be touched
    "icon_url", "image_url", "url", "cta_url", "zoom_url", "signup_url", "group_email",
    "graphic_url", "graphic_image_id", "resource_id",
    # Layout / config tokens — translating these breaks template logic
    "tag_filter", "layout", "link", "color", "format", "mode",
}

import re as _re

def _translate_html(html: str, translator: TranslationService, lang: str) -> str:
    """Translate visible text nodes inside HTML while preserving tags."""
    def _tx(m: "_re.Match") -> str:
        text = m.group(1)
        stripped = text.strip()
        if not stripped:
            return m.group(0)
        try:
            translated = translator.translate(stripped, lang)
            return ">" + translated + "<"
        except Exception:
            return m.group(0)
    return _re.sub(r">([^<]*\S[^<]*)<", _tx, html)


def _translate_dict(obj, translator: TranslationService, lang: str) -> None:
    """Recursively translate all string values in a nested dict/list."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _SKIP_TRANSLATE_KEYS:
                continue
            if k == "rich_content" and isinstance(v, str) and v.strip():
                # Translate HTML content node-by-node to preserve markup
                obj[k] = _translate_html(v, translator, lang)
            elif isinstance(v, str) and v.strip():
                obj[k] = translator.translate(v, lang)
            else:
                _translate_dict(v, translator, lang)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if isinstance(item, str) and item.strip():
                obj[i] = translator.translate(item, lang)
            else:
                _translate_dict(item, translator, lang)


# ── Tag-filter helpers (mirrors the JS parseTagFilter / matchesTagFilter) ──────

def _parse_tag_filter(expr: str) -> dict:
    tokens = [t for t in expr.lower().replace(",", " ").split() if t]
    require, optional, exclude = [], [], []
    for t in tokens:
        if t.startswith("+"):   require.append(t[1:])
        elif t.startswith("-"): exclude.append(t[1:])
        else:                   optional.append(t)
    return {"require": require, "optional": optional, "exclude": exclude}


def _matches_tag_filter(item_tags: list, f: dict) -> bool:
    tags = [t.lower() for t in (item_tags or [])]
    if any(ex in tags for ex in f["exclude"]):  return False
    if f["require"] and not all(r in tags for r in f["require"]): return False
    if f["optional"] and not any(o in tags for o in f["optional"]): return False
    return True


def _select_lang_images(images: list, lang: str) -> list:
    """Deduplicate paired images, keeping the preferred language version."""
    seen_pairs: dict = {}
    out = []
    for img in images:
        pid = img.get("pair_id")
        img_lang = img.get("language", "")
        if not pid:
            out.append(img)
            continue
        if pid not in seen_pairs:
            seen_pairs[pid] = img
        else:
            prev = seen_pairs[pid]
            # Prefer the image whose language matches the requested lang; fall back to neutral
            prev_score = (2 if prev.get("language") == lang else (1 if not prev.get("language") else 0))
            curr_score = (2 if img_lang == lang else (1 if not img_lang else 0))
            if curr_score > prev_score:
                seen_pairs[pid] = img
    # Rebuild order: non-paired first, then best pair representative
    pair_added = set()
    result = []
    for img in images:
        pid = img.get("pair_id")
        if not pid:
            result.append(img)
        elif pid not in pair_added:
            result.append(seen_pairs[pid])
            pair_added.add(pid)
    return result


def _resolve_flyer_images(data: dict, lang: str) -> list[dict]:
    """If the flyer_grid section has a tag_filter, resolve images dynamically."""
    tag_filter = data.get("tag_filter", "").strip()
    if not tag_filter:
        return data.get("images", [])
    try:
        import data.image_store as image_store
        all_images = image_store.get_images()
        f = _parse_tag_filter(tag_filter)
        matched = [img for img in all_images if _matches_tag_filter(img.get("tags", []), f)]
        selected = _select_lang_images(matched, lang)
        return [{"url": img["url"], "alt": img.get("name", img.get("alt", ""))} for img in selected]
    except Exception as exc:
        logger.warning(f"flyer image resolution failed: {exc}")
        return data.get("images", [])


def _resolve_job_grid(data: dict, lang: str) -> list[dict]:
    """Resolve jobs for a job_grid section.

    If job_ids is specified, fetch those specific jobs (in order).
    If tag_filter is specified (and job_ids is empty), filter all active jobs by tag.
    Returns a list of job dicts with bilingual fields swapped for *lang*.
    """
    try:
        import data.jobs_store as jobs_store
        job_ids = data.get("job_ids") or []
        tag_filter = data.get("tag_filter", "").strip()
        if job_ids:
            jobs = [j for j in [jobs_store.get_job(jid) for jid in job_ids] if j and j.get("active", True)]
        elif tag_filter:
            all_jobs = jobs_store.get_jobs(active_only=True)
            f = _parse_tag_filter(tag_filter)
            jobs = [j for j in all_jobs if _matches_tag_filter(j.get("tags") or [], f)]
        else:
            jobs = jobs_store.get_jobs(active_only=True)
        # Swap in translated fields when lang != 'en'
        if lang != "en":
            result = []
            for job in jobs:
                t = (job.get("translations") or {}).get(lang, {})
                if t:
                    job = {**job, **t}
                result.append(job)
            return result
        return jobs
    except Exception as exc:
        logger.warning(f"job_grid resolution failed: {exc}")
        return []


def _resolve_attached_resource(data: dict) -> dict:
    """Fill graphic_url from resource store if not already present in section data."""
    resource_id = data.get("resource_id", "").strip()
    if not resource_id:
        return data
    # If the graphic_url is already baked in, use it directly
    if data.get("graphic_url"):
        return data
    try:
        from data.resource_store import get_resource
        rec = get_resource(resource_id)
        if rec and rec.get("generated_image_url"):
            resolved = deepcopy(data)
            resolved["graphic_url"] = rec["generated_image_url"]
            resolved["graphic_image_id"] = rec.get("generated_image_id")
            return resolved
    except Exception as exc:
        logger.warning(f"attached_resource resolution failed: {exc}")
    return data


def _preprocess_section_data(section_type: str, data: dict, lang: str) -> dict:
    """Return (possibly new) data dict with dynamic fields resolved for the given lang."""
    if section_type == "flyer_grid":
        tag_filter = data.get("tag_filter", "").strip()
        if tag_filter:
            resolved = deepcopy(data)
            resolved["images"] = _resolve_flyer_images(data, lang)
            return resolved
    if section_type == "job_grid":
        resolved = deepcopy(data)
        resolved["jobs"] = _resolve_job_grid(data, lang)
        return resolved
    if section_type == "attached_resource":
        return _resolve_attached_resource(data)
    return data


# ── Public: translate a list of raw section dicts ─────────────────────────────

def translate_sections(sections: list[dict], to_lang: str) -> list[dict]:
    """Translate a list of section dicts to *to_lang* and return new dicts.

    For flyer_grid sections with a tag_filter, the `images` array is cleared
    so the render step resolves the language-appropriate images at render time.

    This is the abstraction layer for swapping providers:
      settings.json  "translation_provider": "google"   → GoogleTranslateService
                                              "claude"   → future ClaudeTranslateService
    """
    translator = _get_translator(to_lang)
    result = []
    for raw in sections:
        s = NewsletterSection.from_dict(raw)
        translated = _translate_section(s, translator, to_lang) if translator else s
        d = deepcopy(translated.data)
        # Clear resolved images for tag-driven grids so render picks the right lang
        if translated.section_type == "flyer_grid" and d.get("tag_filter", "").strip():
            d["images"] = []
        result.append({"id": translated.id, "section_type": translated.section_type, "data": d})
    return result


def render_section(section: NewsletterSection, lang: str = "en", skip_translation: bool = False) -> str:
    """Render a single section to an HTML string (for builder live preview)."""
    try:
        env = _make_env()
        template = env.get_template(f"{section.section_type}.jinja")
        translator = None if skip_translation else _get_translator(lang)
        s = _translate_section(section, translator, lang) if translator else section
        data = _preprocess_section_data(s.section_type, s.data, lang)
        return template.render(**data, lang=lang, settings=get_settings())
    except Exception as exc:
        raise NewsletterError(f"render_section({section.section_type}): {exc}") from exc


def render_email(doc: NewsletterDoc, skip_translation: bool = False) -> str:
    """Render a complete email-safe newsletter HTML document.

    skip_translation=True: render data as-is (used when the canvas is pre-translated
    by the dual-canvas workflow, so we don't double-translate).
    """
    try:
        env = Environment(
            loader=FileSystemLoader(_TEMPLATES_DIR),
            autoescape=select_autoescape(["html", "jinja"]),
        )
        translator = None if skip_translation else _get_translator(doc.language)
        sections_html: list[str] = []
        for section in doc.sections:
            s = _translate_section(section, translator, doc.language) if translator else section
            data = _preprocess_section_data(s.section_type, s.data, doc.language)
            try:
                section_env = _make_env()
                tmpl = section_env.get_template(f"{s.section_type}.jinja")
                sections_html.append(tmpl.render(**data, lang=doc.language, settings=get_settings()))
            except Exception as exc:
                logger.warning(f"Skipping section '{s.section_type}': {exc}")
                sections_html.append(f"<!-- section '{s.section_type}' render error: {exc} -->")

        has_footer_section = any(s.section_type == "footer" for s in doc.sections)
        outer = env.get_template("app/email_wrapper.html")
        return outer.render(
            month=doc.month,
            subtitle=doc.subtitle,
            language=doc.language,
            sections_html=sections_html,
            has_footer_section=has_footer_section,
            settings=get_settings(),
        )
    except NewsletterError:
        raise
    except Exception as exc:
        raise NewsletterError(f"render_email failed: {exc}") from exc
