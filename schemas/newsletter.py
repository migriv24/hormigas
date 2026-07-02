"""Data model for a newsletter document and its composable sections.

Each NewsletterSection holds:
  - section_type: one of SECTION_TYPES
  - data: a free-form dict whose keys depend on the section type (see below)
  - id: short UUID assigned on creation, used as DOM key in the builder UI

Section data shapes (reference):
  hero             : {image_url, title, body, group_email}
  meeting_highlights: {items: [str]}
  event_grid       : {title, subtitle, events: [{icon_url, color, date_label,
                       title, org, time_range, location, link, link_label}],
                       source_row_indexes: [int], include_recurring: bool,
                       cta_url, cta_label}
  highlight_event  : {row_index, event_title, event_days, event_time,
                       event_location, event_virtual_location, event_icon_url,
                       title_override, subtitle, cta_url, cta_label, note}
  meeting_schedule : {meetings: [{format, date}], zoom_url}  # legacy — use highlight_event
  narrative        : {icon_url, title, body_paragraphs: [str],
                       callout: {title, body, color, bg}}
  attendee_list    : {meeting_date, attendees: [{name, org}], note}
  flyer_grid       : {title, subtitle, images: [{url, alt}]}
  job_grid         : {title, subtitle, job_ids: [str], tag_filter: str,
                       show_pay: bool, show_close_date: bool, show_contact: bool,
                       cta_url, cta_label}
  actions_list     : {title, items: [str]}
  directory_cta    : {text, url, btn_label}
  presenter_cta    : {contacts: [{name, email}], signup_url}
  footer           : {author_name, author_email, group_email}
  attached_resource: {resource_id, title, subtitle, caption,
                       show_graphic: bool, graphic_image_id, graphic_url,
                       pages_shown: [int]}
"""
import uuid
from dataclasses import dataclass, field

SECTION_TYPES: list[str] = [
    "hero",
    "meeting_highlights",
    "event_grid",
    "highlight_event",
    "meeting_schedule",     # legacy — kept for backwards compat with saved newsletters
    "narrative",
    "attendee_list",
    "flyer_grid",
    "job_grid",
    "actions_list",
    "directory_cta",
    "presenter_cta",
    "footer",
    "attached_resource",
]

# domain: "content" | "data" | "meta"
SECTION_REGISTRY: list[dict] = [
    {"id": "hero",               "label": "🖼 Hero Card",            "domain": "content", "desc": "Opening image with title and body text"},
    {"id": "meeting_highlights", "label": "📋 Meeting Highlights",   "domain": "content", "desc": "Bulleted summary of key meeting points"},
    {"id": "narrative",          "label": "📝 Narrative Section",    "domain": "content", "desc": "Long-form paragraphs with optional callout"},
    {"id": "actions_list",       "label": "✅ Actions for Network",  "domain": "content", "desc": "Action items and todos"},
    {"id": "highlight_event",    "label": "📌 Highlight Event",      "domain": "data",    "desc": "Single featured event from your dataset"},
    {"id": "event_grid",         "label": "📅 Event Grid",           "domain": "data",    "desc": "Grid of events selected from your dataset"},
    {"id": "attendee_list",      "label": "👥 People in the Room",   "domain": "data",    "desc": "Meeting attendance list from contacts"},
    {"id": "flyer_grid",         "label": "🖼 Image Gallery",         "domain": "data",    "desc": "Images from your library — filter by tag to show only fliers, headshots, etc."},
    {"id": "job_grid",           "label": "💼 Job Opportunities",     "domain": "data",    "desc": "Grid of job listings from your Jobs board — filter by tag or pick specific jobs"},
    {"id": "attached_resource",  "label": "📎 Attached Resource",    "domain": "data",    "desc": "Display a PDF attachment with a generated page preview graphic"},
    {"id": "presenter_cta",      "label": "🎤 Present at a Meeting", "domain": "data",    "desc": "Speaker recruitment with contacts"},
    {"id": "directory_cta",      "label": "📂 Directory CTA",        "domain": "meta",    "desc": "Call-to-action linking to network directory"},
    {"id": "footer",             "label": "📧 Footer",               "domain": "meta",    "desc": "Email footer from settings"},
]

SECTION_LABELS: dict[str, str] = {r["id"]: r["label"] for r in SECTION_REGISTRY}
SECTION_LABELS["meeting_schedule"] = "🗓 Meeting Schedule (legacy)"  # backwards compat


@dataclass
class NewsletterSection:
    section_type: str
    data: dict = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])

    def to_dict(self) -> dict:
        return {"id": self.id, "section_type": self.section_type, "data": self.data}

    @classmethod
    def from_dict(cls, d: dict) -> "NewsletterSection":
        return cls(section_type=d["section_type"], data=d.get("data", {}), id=d.get("id", uuid.uuid4().hex[:8]))


@dataclass
class NewsletterDoc:
    month: str          # e.g. "March 2026"
    subtitle: str = ""
    language: str = "en"   # "en" | "es"
    sections: list[NewsletterSection] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "month": self.month,
            "subtitle": self.subtitle,
            "language": self.language,
            "sections": [s.to_dict() for s in self.sections],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "NewsletterDoc":
        sections = [NewsletterSection.from_dict(s) for s in d.get("sections", [])]
        return cls(
            month=d.get("month", ""),
            subtitle=d.get("subtitle", ""),
            language=d.get("language", "en"),
            sections=sections,
        )
