from dataclasses import dataclass
from typing import Optional

DEFAULT_EVENT_ICON = "https://i.ibb.co/FLvxMqfJ/10691802.png"


@dataclass
class Event:
    title: str
    organization: str
    days: str = ""          # e.g. "Tuesdays & Thursdays" or "January 30, 2026"
    start_time: str = ""
    end_time: str = ""
    location: str = ""      # Physical address / venue
    virtual_location: str = ""  # Zoom link or URL
    contact_email: str = ""
    description: str = ""
    icon_url: str = ""      # col J — small icon for event grid / highlight card
    color: str = "#2563eb"  # Date label color (not stored in sheet)
    row_index: Optional[int] = None

    @classmethod
    def from_sheet_row(cls, row: list, row_index: int) -> "Event":
        def safe(i: int, default: str = "") -> str:
            val = row[i] if i < len(row) else ""
            return str(val).strip() if val else default

        return cls(
            days=safe(0),
            title=safe(1),
            organization=safe(2),
            start_time=safe(3),
            end_time=safe(4),
            location=safe(5),
            virtual_location=safe(6),
            contact_email=safe(7),
            description=safe(8),
            icon_url=safe(9) or DEFAULT_EVENT_ICON,
            row_index=row_index,
        )

    def to_sheet_row(self) -> list:
        return [
            self.days,
            self.title,
            self.organization,
            self.start_time,
            self.end_time,
            self.location,
            self.virtual_location,
            self.contact_email,
            self.description,
            self.icon_url,      # col J
        ]

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "organization": self.organization,
            "days": self.days,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "location": self.location,
            "virtual_location": self.virtual_location,
            "contact_email": self.contact_email,
            "description": self.description,
            "icon_url": self.icon_url,
            "color": self.color,
            "row_index": self.row_index,
        }
