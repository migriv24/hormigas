"""
glyphs — Hormiga's rune types: the newsletter section vocabulary as Void Core
glyphs (SPEC §3.3). One glyph per Jinja partial in templates/newsletter_sections/;
a newsletter block is a rune of one of these glyphs, and the newsletter document
is a mantle of them (VOIDCORE_INTEGRATION.md §2).

`tag_filter` fields hold a SPEC §5 tag expression resolved through a holiday at
render time — the query-backed block (SPEC §10.2). Rendering through the Jinja
partials is the Phase-3 render seam; these declarations make the blocks
creatable/editable/taggable from the dispatcher today.
"""

SECTION_GLYPHS: list[dict] = [
    {"glyph": "hero",               "label": "Hero banner",
     "editor": "form", "fields": ["title", "subtitle", "image_url"]},
    {"glyph": "narrative",          "label": "Narrative text",
     "editor": "form", "fields": ["title", "text_en", "text_es"]},
    {"glyph": "event_grid",         "label": "Event grid",
     "editor": "form", "fields": ["title", "subtitle", "tag_filter"]},
    {"glyph": "highlight_event",    "label": "Highlighted event",
     "editor": "form", "fields": ["title", "event_ref", "text_en", "text_es"]},
    {"glyph": "flyer_grid",         "label": "Flyer grid",
     "editor": "form", "fields": ["title", "subtitle", "tag_filter", "layout"]},
    {"glyph": "job_grid",           "label": "Job grid",
     "editor": "form", "fields": ["title", "subtitle", "tag_filter"]},
    {"glyph": "meeting_highlights", "label": "Meeting highlights",
     "editor": "form", "fields": ["title", "items"]},
    {"glyph": "meeting_schedule",   "label": "Meeting schedule",
     "editor": "form", "fields": ["title", "items"]},
    {"glyph": "presenter_cta",      "label": "Presenter call-to-action",
     "editor": "form", "fields": ["title", "contact_refs", "text_en", "text_es"]},
    {"glyph": "attendee_list",      "label": "Attendee list",
     "editor": "form", "fields": ["title", "tag_filter"]},
    {"glyph": "actions_list",       "label": "Actions list",
     "editor": "form", "fields": ["title", "items"]},
    {"glyph": "directory_cta",      "label": "Directory call-to-action",
     "editor": "form", "fields": ["title", "text_en", "text_es", "link_url"]},
    {"glyph": "attached_resource",  "label": "Attached resource",
     "editor": "form", "fields": ["title", "resource_ref", "preview_url"]},
    {"glyph": "footer",             "label": "Footer",
     "editor": "form", "fields": ["org_name", "group_email", "unsubscribe_note"]},
]


def register_all(vc) -> int:
    """Register every Hormiga glyph on a VoidCore manager; returns the count."""
    n = 0
    for g in SECTION_GLYPHS:
        if vc.register_glyph(g):
            n += 1
    return n
